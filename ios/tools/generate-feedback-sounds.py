"""Generate SpentOn's original short feedback tones; no external audio source."""
import math
from pathlib import Path
import struct
import wave

ROOT = Path(__file__).resolve().parents[1] / "SpentOn" / "Resources"
ROOT.mkdir(exist_ok=True)
RATE = 44100

def tone(name, notes, duration):
    samples = []
    for i in range(round(duration * RATE)):
        t = i / RATE
        value = 0.0
        for start, frequency, length, volume in notes:
            age = t - start
            if 0 <= age < length:
                envelope = (1 - math.exp(-age / 0.008)) * math.exp(-age / 0.095)
                envelope *= min(1, (length - age) / 0.035)
                value += volume * envelope * (math.sin(2 * math.pi * frequency * age) + 0.12 * math.sin(4 * math.pi * frequency * age))
        samples.append(round(max(-0.8, min(0.8, value)) * 32767))
    with wave.open(str(ROOT / (name + ".wav")), "wb") as output:
        output.setparams((1, 2, RATE, len(samples), "NONE", "not compressed"))
        output.writeframes(struct.pack("<" + "h" * len(samples), *samples))

tone("budget-ready", [(0, 523.25, 0.42, 0.28), (0.09, 659.25, 0.42, 0.25), (0.18, 783.99, 0.46, 0.23)], 0.68)
tone("item-added", [(0, 659.25, 0.20, 0.20), (0.035, 987.77, 0.20, 0.09)], 0.25)
