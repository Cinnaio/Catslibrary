import UIKit

extension NSAttributedString.Key {
    static let readerThoughtWave = NSAttributedString.Key("zhizhou.readerThoughtWave")
}

/// TextKit calls this for each wrapped line of an underlined quote, in its actual glyph coordinates.
final class ThoughtWaveLayoutManager: NSLayoutManager {
    override func drawUnderline(forGlyphRange glyphRange: NSRange, underlineType underlineVal: NSUnderlineStyle,
                                baselineOffset: CGFloat, lineFragmentRect lineRect: CGRect,
                                lineFragmentGlyphRange lineGlyphRange: NSRange, containerOrigin: CGPoint) {
        let characterRange = self.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
        guard glyphRange.length > 0, let storage = textStorage, characterRange.location < storage.length,
              storage.attribute(.readerThoughtWave, at: characterRange.location, effectiveRange: nil) as? Bool == true,
              let container = textContainer(forGlyphAt: glyphRange.location, effectiveRange: nil) else {
            super.drawUnderline(forGlyphRange: glyphRange, underlineType: underlineVal, baselineOffset: baselineOffset,
                                lineFragmentRect: lineRect, lineFragmentGlyphRange: lineGlyphRange, containerOrigin: containerOrigin)
            return
        }
        let bounds = boundingRect(forGlyphRange: glyphRange, in: container)
        let font = storage.attribute(.font, at: characterRange.location, effectiveRange: nil) as? UIFont
        let scale = max(1, (font?.pointSize ?? 20) / 20)
        let amplitude = min(1.6, 0.9 * scale)
        let wavelength = 6 * scale
        let baseline = bounds.maxY - baselineOffset + containerOrigin.y
        let y = baseline + max(2, 2 * scale)
        let start = bounds.minX + containerOrigin.x
        let end = bounds.maxX + containerOrigin.x
        guard end > start else { return }
        let wave = UIBezierPath()
        wave.lineWidth = min(1.8, 1.1 * scale)
        wave.lineCapStyle = .round
        var x = start
        wave.move(to: CGPoint(x: x, y: y + sin(x * 2 * .pi / wavelength) * amplitude))
        while x < end {
            x = min(end, x + 0.5)
            wave.addLine(to: CGPoint(x: x, y: y + sin(x * 2 * .pi / wavelength) * amplitude))
        }
        (storage.attribute(.underlineColor, at: characterRange.location, effectiveRange: nil) as? UIColor ?? .secondaryLabel).setStroke()
        wave.stroke()
    }
}
