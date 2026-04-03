"""与 web 端 normal 策略对齐。"""

NORMAL_STRATEGY = {
    "fill_ratio": 0.20,
    "grid_width": 9,
    "scoring": {"single_line": 20, "multi_line": 60, "combo": 100},
    "shape_weights": {
        "lines": 1.5,
        "squares": 1.5,
        "tshapes": 1.2,
        "zshapes": 1.2,
        "lshapes": 1.2,
        "jshapes": 1.2,
    },
}

WIN_SCORE_THRESHOLD = 220
