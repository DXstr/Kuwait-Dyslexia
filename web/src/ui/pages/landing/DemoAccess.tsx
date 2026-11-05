import { useState } from 'react'
import { useAuth } from '../../../auth/context'
import { Button } from '../../core'

// Shared public accounts that only hold the labelled demo child. The password is public by design.
const password = import.meta.env.VITE_DEMO_PASSWORD as string | undefined

const accounts = [
  { email: 'demo-specialist@basira-demo.example', label: 'الدخول كاختصاصي' },
  { email: 'demo-guardian@basira-demo.example', label: 'الدخول كولي أمر' },
  { email: 'demo-examiner@basira-demo.example', label: 'الدخول كفاحص' },
] as const

export const DEMO_SPECIALIST_ID = 'd0000000-0000-4000-a000-000000000001'

export function DemoAccess() {
  const { controller } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!password || !controller.signInDemo) return null
  const enter = async (email: string) => {
    setBusy(true)
    try { await controller.signInDemo?.(email, password) } finally { setBusy(false) }
  }
  return (
    <div className="landing-demo-access" role="group" aria-label="جرّب العرض التجريبي دون حساب">
      <p className="landing-auth-hint">جرّب العرض التجريبي بضغطة واحدة، بملف طفل تجريبي:</p>
      <div className="landing-demo-access__buttons">
        {accounts.map(({ email, label }) => (
          <Button key={email} variant="outline" type="button" disabled={busy} onClick={() => { void enter(email) }}>{label}</Button>
        ))}
      </div>
    </div>
  )
}
