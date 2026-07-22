import { describe, expect, it } from 'vitest'
import { sameAnswers } from './scoring'

describe('sameAnswers', () => {
  it('accepts a single exact answer', () => {
    expect(sameAnswers(['C'], ['C'])).toBe(true)
    expect(sameAnswers(['B'], ['C'])).toBe(false)
  })

  it('requires an exact multiple-choice set', () => {
    expect(sameAnswers(['D', 'A', 'C'], ['A', 'C', 'D'])).toBe(true)
    expect(sameAnswers(['A', 'C'], ['A', 'C', 'D'])).toBe(false)
    expect(sameAnswers(['A', 'B', 'C', 'D'], ['A', 'C', 'D'])).toBe(false)
  })
})
