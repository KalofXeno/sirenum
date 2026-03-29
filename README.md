# Sirenum

Tools and pipelines for Mars remote sensing analysis, focused on the Sirenum Terra region.

## Overview

Sirenum provides utilities for processing and analyzing remote sensing data from Mars orbital instruments. The project supports workflows common in planetary science research, including:

- Ingesting and calibrating orbital imagery (HiRISE, CTX, THEMIS)
- Generating digital terrain models (DTMs) from stereo pairs
- Spectral analysis of mineralogical signatures (CRISM/OMEGA)
- Mapping surface features such as gullies, RSL, and channel networks

## Data Sources

| Instrument | Platform | Resolution | Use Case |
|---|---|---|---|
| HiRISE | MRO | ~0.25 m/px | High-res surface morphology |
| CTX | MRO | ~6 m/px | Regional context imaging |
| THEMIS | Mars Odyssey | 100 m (VIS) / 18 m (IR) | Thermal inertia mapping |
| CRISM | MRO | 18 m/px | Mineral identification |
| MOLA | MGS | ~463 m/px | Global topography |

## Getting Started

```bash
git clone https://github.com/kalofxeno/sirenum.git
cd sirenum
```

## License

See [LICENSE](LICENSE) for details.
