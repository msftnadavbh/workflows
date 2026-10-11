import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("presentation")
    args = parser.parse_args()
    source = Path(args.presentation)
    ns = {
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "r": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    problems = []
    with ZipFile(source) as archive:
        if archive.testzip() is not None:
            problems.append("Corrupt ZIP entry")
        names = set(archive.namelist())
        slides = sorted(
            [name for name in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)],
            key=lambda name: int(re.search(r"(\d+)\.xml", name).group(1)),
        )
        if len(slides) != 26:
            problems.append(f"Expected 26 slides, found {len(slides)}")
        for name in names:
            if name.endswith(".xml") or name.endswith(".rels"):
                try:
                    tree = ET.fromstring(archive.read(name))
                except ET.ParseError as error:
                    problems.append(f"{name}: invalid XML: {error}")
                    continue
                if name.endswith(".rels"):
                    parent = PurePosixPath(name).parent.parent
                    for relationship in tree:
                        target = relationship.attrib.get("Target", "")
                        if relationship.attrib.get("TargetMode") == "External":
                            continue
                        joined = parent / target
                        pieces = []
                        for piece in joined.parts:
                            if piece == "..":
                                if pieces:
                                    pieces.pop()
                            elif piece != ".":
                                pieces.append(piece)
                        resolved = "/".join(pieces)
                        if resolved not in names:
                            problems.append(f"{name}: missing relationship {resolved}")
        for index, name in enumerate(slides, 1):
            tree = ET.fromstring(archive.read(name))
            if index > 21 and tree.attrib.get("show") != "0":
                problems.append(f"Slide {index}: reference slide must be hidden during the main show")
            text = "\n".join(node.text or "" for node in tree.findall(".//a:t", ns))
            if not text.strip():
                problems.append(f"Slide {index}: no text")
            if re.search(r"\b(lorem ipsum|TODO|TBD|xxxx)\b", text, re.I):
                problems.append(f"Slide {index}: placeholder text")
            notes_path = f"ppt/notesSlides/notesSlide{index}.xml"
            if notes_path not in names:
                problems.append(f"Slide {index}: missing notes")
            else:
                notes_tree = ET.fromstring(archive.read(notes_path))
                notes = "\n".join(node.text or "" for node in notes_tree.findall(".//a:t", ns))
                if "SOURCES" not in notes or "https://" not in notes:
                    problems.append(f"Slide {index}: missing source citations")
            visual = tree.findall(".//p:sp", ns) + tree.findall(".//p:pic", ns)
            if len(visual) < 4:
                problems.append(f"Slide {index}: missing visual composition")
        media = [name for name in names if name.startswith("ppt/media/")]
        if not media:
            problems.append("No embedded demo screenshot")
    manifest = json.loads(Path(r"presentation\slide-manifest.json").read_text(encoding="utf-8"))
    for slide in manifest:
        for item in slide["objects"]:
            if item["x"] < 0 or item["y"] < 0 or item["x"] + item["w"] > 13.36 or item["y"] + item["h"] > 7.52:
                problems.append(f"Slide {slide['number']}: object outside bounds")
    if problems:
        for problem in problems:
            print("FAIL:", problem)
        raise SystemExit(1)
    print(f"Verified {len(slides)} slides, hidden reference section, notes, source links, embedded media, XML, relationships, and object bounds.")


if __name__ == "__main__":
    main()
