"""Translate the existing Pip SVG into native vector paths, preserving its layers."""
from pathlib import Path
import hashlib
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
source = root / "src/brand/pip.svg"
target = root / "ios/SpentOn/Sources/App/PipVectorArtwork.swift"
svg = ET.fromstring(source.read_text())
if svg.get("viewBox") != "0 0 180 180":
    raise ValueError("Pip's viewBox changed; update native character framing before building.")
parts = []
layers = {
    "pip-contact": "shadow", "leg-left": "leftLeg", "leg-right": "rightLeg",
    "sprout": "sprout", "arm-left": "leftArm", "arm-right": "rightArm",
    "eyes": "eyes", "happy-eyes": "happyEyes", "sleep-eyes": "closedEyes",
    "worried-brows": "brows", "smile": "smile", "worried-mouth": "worriedMouth",
    "yawn-mouth": "mouth", "hug-heart": "heart",
}

def number(value):
    return format(float(value), ".8g")

def point(x, y):
    return f"CGPoint(x: {number(x)}, y: {number(y)})"

def path_commands(data):
    tokens = re.findall(r"[A-Za-z]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?", data)
    commands = []
    i = 0
    command = None
    x = y = sx = sy = 0.0
    control = None
    while i < len(tokens):
        if tokens[i].isalpha():
            command = tokens[i]
            i += 1
        if not command:
            raise ValueError("Missing path command")
        relative = command.islower()
        kind = command.upper()
        if kind == "Z":
            commands.append("path.closeSubpath()")
            x, y, control, command = sx, sy, None, None
            continue
        count = {"M": 2, "L": 2, "Q": 4, "T": 2, "C": 6}.get(kind)
        if count is None:
            raise ValueError(f"Unsupported Pip path command: {kind}")
        values = list(map(float, tokens[i:i+count]))
        if len(values) != count:
            raise ValueError("Incomplete Pip path")
        i += count
        pairs = [(values[j] + (x if relative else 0), values[j+1] + (y if relative else 0)) for j in range(0, count, 2)]
        ex, ey = pairs[-1]
        if kind == "M":
            commands.append(f"path.move(to: {point(ex, ey)})")
            sx, sy = ex, ey
            command = "l" if relative else "L"
        elif kind == "L":
            commands.append(f"path.addLine(to: {point(ex, ey)})")
        elif kind in ("Q", "T"):
            cx, cy = pairs[0] if kind == "Q" else (2*x-control[0], 2*y-control[1]) if control else (x, y)
            commands.append(f"path.addQuadCurve(to: {point(ex, ey)}, control: {point(cx, cy)})")
            control = (cx, cy)
        elif kind == "C":
            commands.append(f"path.addCurve(to: {point(ex, ey)}, control1: {point(*pairs[0])}, control2: {point(*pairs[1])})")
        if kind not in ("Q", "T"):
            control = None
        x, y = ex, ey
    return commands

def color(value):
    if value == "none":
        return None
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError(f"Unsupported Pip color: {value}")
    return "Color(.sRGB, red: %.8f, green: %.8f, blue: %.8f, opacity: 1)" % tuple(int(value[i:i+2], 16)/255 for i in (1, 3, 5))

def walk(element, inherited, layer="body", follows_body=False):
    tag = element.tag.rsplit("}", 1)[-1]
    if tag in ("defs", "style"):
        return
    if tag not in ("svg", "g", "path", "circle", "ellipse"):
        raise ValueError(f"Unsupported Pip artwork element: {tag}")
    attrs = dict(inherited)
    for key in ("fill", "stroke", "stroke-width", "stroke-dasharray"):
        if key in element.attrib:
            attrs[key] = element.attrib[key]
    attrs["opacity"] = float(inherited.get("opacity", 1)) * float(element.get("opacity", 1))
    classes = element.get("class", "").split()
    follows_body = follows_body or "body" in classes
    for cls in classes:
        layer = layers.get(cls, layer)
    if tag in ("path", "circle", "ellipse"):
        if tag == "path":
            commands = path_commands(element.attrib["d"])
        else:
            cx, cy = float(element.get("cx", 0)), float(element.get("cy", 0))
            rx = float(element.get("r", element.get("rx", 0)))
            ry = float(element.get("r", element.get("ry", 0)))
            commands = [f"path.addEllipse(in: CGRect(x: {number(cx-rx)}, y: {number(cy-ry)}, width: {number(2*rx)}, height: {number(2*ry)}))"]
        fill = attrs.get("fill", "#000000")
        fill = ".fabric" if fill == "url(#pip-fabric)" else ".solid(" + color(fill) + ")" if color(fill) else ".none"
        stroke = color(attrs.get("stroke", "none")) or "nil"
        dash = ", ".join(number(v) for v in attrs.get("stroke-dasharray", "").split())
        parts.append((commands, f"layer: .{layer}, followsBody: {str(follows_body).lower()}, path: path, fill: {fill}, stroke: {stroke}, width: {number(attrs.get('stroke-width', 1))}, opacity: {number(attrs['opacity'])}, dash: [{dash}]"))
    for child in element:
        walk(child, attrs, layer, follows_body)

walk(svg, {})
digest = hashlib.sha256(source.read_bytes()).hexdigest()
lines = ["// Generated from src/brand/pip.svg. Run ios/tools/generate-pip-vector.py.", f"// Source SHA-256: {digest}", "import SwiftUI", "", "enum PipVectorArtwork {",
         "    static let parts: [PipVectorPart] = [" + ", ".join(f"part{i}()" for i in range(len(parts))) + "]"]
for i, (commands, construction) in enumerate(parts):
    lines += [f"    private static func part{i}() -> PipVectorPart {{", "        var path = Path()"]
    lines += ["        " + command for command in commands]
    lines += ["        return PipVectorPart(" + construction + ")", "    }"]
lines += ["}", ""]
target.write_text("\n".join(lines))
print(f"Pip: {len(parts)} native vector layers generated from the existing artwork.")
