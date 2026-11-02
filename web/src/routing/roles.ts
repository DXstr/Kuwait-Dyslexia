// Application navigation metadata, not a scorer payload. These are the profile
// roles in contracts/data-model.md. Children never have their own auth role.
export type AppRole = 'guardian' | 'specialist' | 'examiner' | 'admin'

export const roleHome: Record<AppRole, string> = {
  guardian: '/guardian',
  specialist: '/specialist',
  examiner: '/examiner',
  admin: '/admin',
}

export function canAccess(role: AppRole | null, allowedRoles: readonly AppRole[]) {
  return role !== null && allowedRoles.includes(role)
}

export function canUseEnglish(role: AppRole | null, pathname: string) {
  return (
    (role === 'specialist' && pathname === '/specialist') ||
    (role === 'examiner' && pathname === '/examiner')
  )
}
