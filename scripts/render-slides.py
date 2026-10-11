import argparse
import json
from pathlib import Path

import pythoncom
import pywintypes
import win32com.client
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("presentation")
    parser.add_argument("--out", default=r"presentation\rendered")
    args = parser.parse_args()
    source = Path(args.presentation).resolve()
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=True)
    pythoncom.CoInitialize()
    try:
        win32com.client.GetActiveObject("PowerPoint.Application")
        previously_running = True
    except pywintypes.com_error as error:
        if error.hresult != -2147221021:
            raise
        previously_running = False
    app = win32com.client.DispatchEx("PowerPoint.Application")
    initial_count = app.Presentations.Count
    presentation = None
    try:
        presentation = app.Presentations.Open(str(source), True, False, False)
        for index in range(1, presentation.Slides.Count + 1):
            presentation.Slides(index).Export(str(output / f"slide-{index:02}.png"), "PNG", 1600, 900)
        presentation.SaveAs(str(source.with_suffix(".pdf")), 32)
        count = presentation.Slides.Count
        shape_audit = []
        for index in range(1, count + 1):
            slide = presentation.Slides(index)
            for position in range(1, slide.Shapes.Count + 1):
                shape = slide.Shapes(position)
                if shape.HasTextFrame and shape.TextFrame.HasText:
                    frame = shape.TextFrame2
                    if frame.TextRange.BoundHeight > shape.Height + 2:
                        shape_audit.append({
                            "slide": index,
                            "shape": shape.Name,
                            "height": shape.Height,
                            "textHeight": frame.TextRange.BoundHeight,
                            "text": shape.TextFrame.TextRange.Text[:160],
                        })
        (output / "text-overflow-audit.json").write_text(json.dumps(shape_audit, indent=2), encoding="utf-8")
    finally:
        if presentation is not None:
            presentation.Close()
        # Do not close another user's already-open presentations.
        if not previously_running and initial_count == 0 and app.Presentations.Count == 0:
            app.Quit()
        pythoncom.CoUninitialize()

    for start in range(1, count + 1, 6):
        indices = list(range(start, min(count + 1, start + 6)))
        sheet = Image.new("RGB", (1200, 1062), "#f7f4ef")
        draw = ImageDraw.Draw(sheet)
        for cell, index in enumerate(indices):
            with Image.open(output / f"slide-{index:02}.png") as original:
                preview = original.resize((580, 326), Image.Resampling.LANCZOS)
            x = 10 + (cell % 2) * 600
            y = 10 + (cell // 2) * 350
            sheet.paste(preview, (x, y))
            draw.text((x, y + 330), f"Slide {index:02}", fill="#242424")
        sheet.save(output / f"contact-{start:02}.png")
    print(f"Rendered {count} slides with installed PowerPoint; PDF and contact sheets saved.")
    print(f"Text overflow candidates: {len(shape_audit)} (see text-overflow-audit.json)")


if __name__ == "__main__":
    main()
