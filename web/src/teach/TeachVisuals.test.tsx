import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getCanonicalPhoneticInventory } from './catalogue'
import { MouthShapeRenderer, TracePad } from './TeachVisuals'

describe('Teach visuals', () => {
  it('renders the reviewed canonical Arabic cue without child-facing English or judgement labels', () => {
    const letter = getCanonicalPhoneticInventory().letters.find((candidate) => candidate.char === 'ب')!
    render(<MouthShapeRenderer letter={letter} label="شكل الفم المساعد" />)

    expect(screen.getByRole('img', { name: 'شكل الفم المساعد' })).toBeVisible()
    expect(screen.getByText('ب')).toBeVisible()
    expect(document.body.textContent).not.toMatch(/wrong|score|risk|خطأ|درجة|خطر/i)
  })

  it('does not create evidence from an empty trace and completes only after ink exists', () => {
    const onComplete = vi.fn()
    render(<TracePad
      label="تتبّع بهدوء"
      resetLabel="نبدأ من جديد"
      completeLabel="أنهي التتبّع"
      note="التتبّع للتدرّب فقط؛ لم نحتسب الكتابة ولم نحوّلها إلى نتيجة."
      canvasLabel="مساحة تتبّع الحرف"
      onComplete={onComplete}
    />)

    const complete = screen.getByRole('button', { name: 'أنهي التتبّع' })
    expect(complete).toBeDisabled()
    expect(screen.getByText(/للتدرّب فقط/)).toBeVisible()

    const canvas = screen.getByLabelText('مساحة تتبّع الحرف')
    expect(canvas).toHaveAttribute('class', 'teach-trace-pad')
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 })
    expect(complete).toBeEnabled()
    fireEvent.click(complete)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
