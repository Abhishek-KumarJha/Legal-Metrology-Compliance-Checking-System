import json
import os
import sys

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR


def create_ocr():
    return PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )


def recognize(ocr, paths):
    for image_path in paths:
        page = ocr.predict(image_path)[0].json["res"]
        yield {
            "path": image_path,
            "texts": page.get("rec_texts", []),
            "scores": page.get("rec_scores", []),
            "boxes": page.get("rec_boxes", []),
        }


def main():
    if "--worker" in sys.argv:
        ocr = create_ocr()
        for line in sys.stdin:
            paths = json.loads(line)
            print(json.dumps(list(recognize(ocr, paths)), ensure_ascii=False), flush=True)
        return
    paths = sys.argv[1:]
    if not paths:
        print(json.dumps([]))
        return
    print(json.dumps(list(recognize(create_ocr(), paths)), ensure_ascii=False))


if __name__ == "__main__":
    main()
