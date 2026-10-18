| candidate | device | exact (lenient) | exact (strict) | mean token NED | median s/formula | mean s/display | est. 605 formulas | peak GB |
|---|---|---|---|---|---|---|---|---|
| CodeFormulaV2 via docling stage, CPU bf16, bs5 (reference) | cpu | 19/33 (58%) | 15/33 (45%) | 0.077 | 24.4 (batch 5) | 24.4 | 246 min | ~1.2 (RSS) |
| CodeFormulaV2 (0.3B) transformers, MPS bf16, bs1 | mps | 20/33 (61%) | 16/33 (48%) | 0.081 | 1.25 | 1.48 | 14.9 min | 1.4 |
|   same, 4% crop margin | mps | 22/33 (67%) | 19/33 (58%) | 0.057 | 1.26 | 1.40 | 14.1 min | 1.4 |
|   same, fp16 | mps | 20/33 (61%) | 16/33 (48%) | 0.081 | 1.10 | 1.27 | 12.8 min | 1.4 |
| GLM-OCR 4bit (mlx-vlm) "Formula Recognition:" | mlx | 27/33 (82%) | 26/33 (79%) | 0.014 | 0.29 | 0.46 | 4.6 min | 2.0 |
|   same, 4% crop margin | mlx | 22/33 (67%) | 22/33 (67%) | 0.020 | 0.27 | 0.43 | 4.3 min | 1.9 |
| PaddleOCR-VL-1.6 4bit (mlx-vlm) "Formula Recognition:" | mlx | 20/33 (61%) | 19/33 (58%) | 0.091 | 0.45 | 0.52 | 5.2 min | 1.5 |
|   same, 4% crop margin | mlx | 25/33 (76%) | 23/33 (70%) | 0.039 | 0.43 | 0.49 | 5.0 min | 1.5 |
| Granite-Docling-258M (mlx-vlm) "<formula>" | mlx | 19/33 (58%) | 17/33 (52%) | 0.088 | 0.77 | 0.92 | 9.3 min | 1.5 |
|   same, 4% crop margin | mlx | 22/33 (67%) | 21/33 (64%) | 0.058 | 0.83 | 0.95 | 9.6 min | 1.5 |
| texify (vikp/texify) MPS fp16 | mps | 18/33 (55%) | 17/33 (52%) | 0.109 | 0.57 | 1.01 | 10.2 min | 1.3 |
|   same, 4% crop margin | mps | 16/33 (48%) | 16/33 (48%) | 0.138 | 0.52 | 0.83 | 8.4 min | 1.3 |
| pix2tex (LaTeX-OCR), CPU | cpu | 10/33 (30%) | 10/33 (30%) | 0.296 | 1.87 | 4.14 | 41.8 min | - |
|   same, 4% crop margin | cpu | 10/33 (30%) | 10/33 (30%) | 0.199 | 1.17 | 2.74 | 27.7 min | - |
| pix2tex, MPS (patched device) | mps | 10/33 (30%) | 10/33 (30%) | 0.296 | 1.60 | 2.95 | 29.7 min | 1.4 |
| qwen3.5 9.7B Q4 via Ollama (installed) | ollama/Metal | 20/33 (61%) | 20/33 (61%) | 0.035 | 3.50 | 5.48 | 55.3 min | - |
|   same, 4% crop margin | ollama/Metal | 17/33 (52%) | 17/33 (52%) | 0.040 | 3.39 | 5.57 | 56.2 min | - |
