import { describe, it, expect } from 'vitest'
import {
  resolveKeyframes,
  hasKeyframeAt,
  findKeyframeAt,
  applyEasing,
  KF_TOLERANCE,
} from './animations'
import type { KeyframeSnapshot } from './editorTypes'

// ── Test fixtures ────────────────────────────────────────────────────────────

function makeSnapshot(time: number, overrides: Partial<KeyframeSnapshot> = {}): KeyframeSnapshot {
  return {
    id: `kf-${time}`,
    time,
    easing: 'linear',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    scale: 1,
    borderRadius: 0,
    blur: 0,
    ...overrides,
  }
}

// ── applyEasing ──────────────────────────────────────────────────────────────

describe('applyEasing', () => {
  it('linear returns the input value unchanged', () => {
    expect(applyEasing('linear', 0)).toBe(0)
    expect(applyEasing('linear', 0.5)).toBe(0.5)
    expect(applyEasing('linear', 1)).toBe(1)
    expect(applyEasing('linear', 0.25)).toBe(0.25)
  })

  it('easeInOut at 0.5 returns 0.5 (symmetric midpoint)', () => {
    expect(applyEasing('easeInOut', 0.5)).toBeCloseTo(0.5, 10)
  })

  it('easeInOut at 0 returns 0', () => {
    expect(applyEasing('easeInOut', 0)).toBe(0)
  })

  it('easeInOut at 1 returns 1', () => {
    expect(applyEasing('easeInOut', 1)).toBe(1)
  })

  it('easeIn at 0.5 is less than 0.5 (slow start)', () => {
    expect(applyEasing('easeIn', 0.5)).toBeLessThan(0.5)
  })

  it('easeOut at 0.5 is greater than 0.5 (fast start)', () => {
    expect(applyEasing('easeOut', 0.5)).toBeGreaterThan(0.5)
  })

  it('clamps values below 0 to 0', () => {
    expect(applyEasing('linear', -0.5)).toBe(0)
    expect(applyEasing('easeIn', -1)).toBe(0)
  })

  it('clamps values above 1 to 1', () => {
    expect(applyEasing('linear', 1.5)).toBe(1)
    expect(applyEasing('easeOut', 2)).toBe(1)
  })

  it('bounce returns a value in [0, 1] range for inputs in [0, 1]', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const result = applyEasing('bounce', t)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(1.1) // bounce can slightly exceed 1 before settling
    }
  })
})

// ── resolveKeyframes ─────────────────────────────────────────────────────────

describe('resolveKeyframes', () => {
  it('returns empty object when keyframes is undefined', () => {
    expect(resolveKeyframes(undefined, 1)).toEqual({})
  })

  it('returns empty object when keyframes is an empty array', () => {
    expect(resolveKeyframes([], 1)).toEqual({})
  })

  describe('single keyframe (hold)', () => {
    const kf = makeSnapshot(1, { x: 50, y: 80, width: 200, height: 150, rotation: 45, opacity: 0.8, scale: 1.5, borderRadius: 10, blur: 5 })

    it('returns the snapshot values when there is only one keyframe', () => {
      const result = resolveKeyframes([kf], 1)
      expect(result.x).toBe(50)
      expect(result.y).toBe(80)
      expect(result.width).toBe(200)
      expect(result.height).toBe(150)
      expect(result.rotation).toBe(45)
      expect(result.opacity).toBe(0.8)
      expect(result.scale).toBe(1.5)
    })

    it('holds the snapshot before its time', () => {
      const result = resolveKeyframes([kf], 0)
      expect(result.x).toBe(50)
      expect(result.opacity).toBe(0.8)
    })

    it('holds the snapshot after its time', () => {
      const result = resolveKeyframes([kf], 5)
      expect(result.x).toBe(50)
      expect(result.opacity).toBe(0.8)
    })
  })

  describe('two keyframes — hold behaviour', () => {
    const kfA = makeSnapshot(1, { x: 0, y: 0, opacity: 0, scale: 1, width: 100, height: 100, rotation: 0, borderRadius: 0, blur: 0 })
    const kfB = makeSnapshot(3, { x: 100, y: 200, opacity: 1, scale: 2, width: 300, height: 400, rotation: 90, borderRadius: 20, blur: 8 })
    const keyframes = [kfA, kfB]

    it('holds first snapshot values before the first keyframe time', () => {
      const result = resolveKeyframes(keyframes, 0)
      expect(result.x).toBe(0)
      expect(result.opacity).toBe(0)
    })

    it('holds last snapshot values after the last keyframe time', () => {
      const result = resolveKeyframes(keyframes, 5)
      expect(result.x).toBe(100)
      expect(result.opacity).toBe(1)
    })
  })

  describe('linear interpolation between two snapshots', () => {
    const kfA = makeSnapshot(0, { x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 0, scale: 1, borderRadius: 0, blur: 0, easing: 'linear' })
    const kfB = makeSnapshot(2, { x: 200, y: 100, width: 300, height: 500, rotation: 180, opacity: 1, scale: 3, borderRadius: 40, blur: 10, easing: 'linear' })
    const keyframes = [kfA, kfB]

    it('interpolates x linearly at 50% between two keyframes', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.x).toBeCloseTo(100, 10) // 0 + (200 - 0) * 0.5
    })

    it('interpolates y linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.y).toBeCloseTo(50, 10)
    })

    it('interpolates opacity linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.opacity).toBeCloseTo(0.5, 10)
    })

    it('interpolates width linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.width).toBeCloseTo(200, 10)
    })

    it('interpolates height linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.height).toBeCloseTo(300, 10)
    })

    it('interpolates rotation linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.rotation).toBeCloseTo(90, 10)
    })

    it('interpolates scale linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.scale).toBeCloseTo(2, 10)
    })

    it('interpolates borderRadius linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.borderRadius).toBeCloseTo(20, 10)
    })

    it('interpolates blur linearly at 50%', () => {
      const result = resolveKeyframes(keyframes, 1)
      expect(result.blur).toBeCloseTo(5, 10)
    })

    it('interpolates all KeyframableProperty values at 25%', () => {
      const result = resolveKeyframes(keyframes, 0.5) // t = 0.25
      expect(result.x).toBeCloseTo(50, 10)
      expect(result.opacity).toBeCloseTo(0.25, 10)
    })
  })

  describe('easeInOut easing differs from linear at midpoint', () => {
    // Both keyframes span 0→2 with different easings but same start/end values
    const makeKfs = (easing: 'linear' | 'easeInOut') => [
      makeSnapshot(0, { x: 0, opacity: 0, easing }),
      makeSnapshot(2, { x: 100, opacity: 1, easing: 'linear' }),
    ]

    it('easeInOut at t=0.5 gives x == 50 (symmetric)', () => {
      const result = resolveKeyframes(makeKfs('easeInOut'), 1)
      // easeInOut at exactly 0.5 is 0.5 → same as linear at midpoint
      expect(result.x).toBeCloseTo(50, 5)
    })

    it('easeInOut at t=0.25 gives a smaller x than linear', () => {
      const linearResult = resolveKeyframes(makeKfs('linear'), 0.5)
      const easeResult = resolveKeyframes(makeKfs('easeInOut'), 0.5)
      // easeInOut is slower at the start, so x should be less than linear
      expect(easeResult.x).toBeLessThan(linearResult.x!)
    })

    it('easeInOut at t=0.75 gives a larger x than linear', () => {
      const linearResult = resolveKeyframes(makeKfs('linear'), 1.5)
      const easeResult = resolveKeyframes(makeKfs('easeInOut'), 1.5)
      // easeInOut is faster in the middle, so past midpoint it should be ahead
      expect(easeResult.x).toBeGreaterThan(linearResult.x!)
    })
  })

  describe('three or more keyframes — segment selection', () => {
    const kfA = makeSnapshot(0, { x: 0, opacity: 0, easing: 'linear' })
    const kfB = makeSnapshot(2, { x: 100, opacity: 0.5, easing: 'linear' })
    const kfC = makeSnapshot(4, { x: 300, opacity: 1, easing: 'linear' })
    const keyframes = [kfA, kfB, kfC]

    it('uses the first segment [kfA, kfB] at t=1', () => {
      const result = resolveKeyframes(keyframes, 1)
      // linear interpolation: x = 0 + (100 - 0) * 0.5 = 50
      expect(result.x).toBeCloseTo(50, 10)
    })

    it('uses the second segment [kfB, kfC] at t=3', () => {
      const result = resolveKeyframes(keyframes, 3)
      // raw = (3 - 2) / (4 - 2) = 0.5; x = 100 + (300 - 100) * 0.5 = 200
      expect(result.x).toBeCloseTo(200, 10)
    })

    it('holds the last snapshot value after all keyframes', () => {
      const result = resolveKeyframes(keyframes, 10)
      expect(result.x).toBe(300)
    })

    it('holds the first snapshot value before all keyframes', () => {
      const result = resolveKeyframes(keyframes, -1)
      expect(result.x).toBe(0)
    })

    it('handles unsorted keyframes by sorting them first', () => {
      // Provide keyframes out of order — function must sort them
      const unsorted = [kfC, kfA, kfB]
      const result = resolveKeyframes(unsorted, 1)
      expect(result.x).toBeCloseTo(50, 10)
    })
  })
})

// ── hasKeyframeAt ─────────────────────────────────────────────────────────────

describe('hasKeyframeAt', () => {
  it('returns false when keyframes is undefined', () => {
    expect(hasKeyframeAt(undefined, 1)).toBe(false)
  })

  it('returns false when keyframes is an empty array', () => {
    expect(hasKeyframeAt([], 1)).toBe(false)
  })

  it('returns true when time matches exactly', () => {
    const kfs = [makeSnapshot(2)]
    expect(hasKeyframeAt(kfs, 2)).toBe(true)
  })

  it('returns true when time is within KF_TOLERANCE', () => {
    const kfs = [makeSnapshot(2)]
    expect(hasKeyframeAt(kfs, 2 + KF_TOLERANCE)).toBe(true)
    expect(hasKeyframeAt(kfs, 2 - KF_TOLERANCE)).toBe(true)
  })

  it('returns true when time is just inside KF_TOLERANCE', () => {
    const kfs = [makeSnapshot(2)]
    expect(hasKeyframeAt(kfs, 2 + KF_TOLERANCE - 0.001)).toBe(true)
  })

  it('returns false when time is just outside KF_TOLERANCE', () => {
    const kfs = [makeSnapshot(2)]
    expect(hasKeyframeAt(kfs, 2 + KF_TOLERANCE + 0.001)).toBe(false)
    expect(hasKeyframeAt(kfs, 2 - KF_TOLERANCE - 0.001)).toBe(false)
  })

  it('KF_TOLERANCE default value is 0.15', () => {
    expect(KF_TOLERANCE).toBe(0.15)
  })

  it('accepts a custom tolerance', () => {
    const kfs = [makeSnapshot(2)]
    expect(hasKeyframeAt(kfs, 2.3, 0.5)).toBe(true)
    expect(hasKeyframeAt(kfs, 2.3, 0.1)).toBe(false)
  })

  it('returns true if any keyframe (not just the first) is within tolerance', () => {
    const kfs = [makeSnapshot(1), makeSnapshot(3), makeSnapshot(5)]
    expect(hasKeyframeAt(kfs, 3)).toBe(true)
    expect(hasKeyframeAt(kfs, 5.1)).toBe(true)
  })
})

// ── findKeyframeAt ────────────────────────────────────────────────────────────

describe('findKeyframeAt', () => {
  it('returns undefined when keyframes is undefined', () => {
    expect(findKeyframeAt(undefined, 1)).toBeUndefined()
  })

  it('returns undefined when keyframes is an empty array', () => {
    expect(findKeyframeAt([], 1)).toBeUndefined()
  })

  it('returns the matching keyframe when time matches exactly', () => {
    const kf = makeSnapshot(2, { x: 42 })
    expect(findKeyframeAt([kf], 2)).toBe(kf)
  })

  it('returns the matching keyframe when time is within tolerance', () => {
    const kf = makeSnapshot(2, { x: 42 })
    expect(findKeyframeAt([kf], 2 + KF_TOLERANCE)).toBe(kf)
    expect(findKeyframeAt([kf], 2 - KF_TOLERANCE)).toBe(kf)
  })

  it('returns undefined when no keyframe is within tolerance', () => {
    const kfs = [makeSnapshot(1), makeSnapshot(3)]
    expect(findKeyframeAt(kfs, 2)).toBeUndefined()
  })

  it('returns the first matching keyframe among multiple', () => {
    const kf1 = makeSnapshot(2, { x: 10 })
    const kf2 = makeSnapshot(2.05, { x: 20 }) // also within default tolerance of 2
    const result = findKeyframeAt([kf1, kf2], 2)
    // find() returns the first match
    expect(result).toBe(kf1)
  })

  it('accepts a custom tolerance', () => {
    const kf = makeSnapshot(2)
    expect(findKeyframeAt([kf], 2.4, 0.5)).toBe(kf)
    expect(findKeyframeAt([kf], 2.6, 0.5)).toBeUndefined()
  })
})
