export const childCopy = {
  shell: {
    eyebrow: 'مساحتنا الهادئة',
    readingTitle: 'نقرأ معًا، بهدوء',
    teachingTitle: 'نتدرّب معًا، خطوة واحدة',
    readingAlt: 'نور في وضع القراءة',
    teachingAlt: 'نور في وضع التعلّم',
    curiousAlt: 'نور في وضع الفضول',
    encouragingAlt: 'نور في وضع التشجيع',
    celebratingAlt: 'نور في وضع الاحتفال',
  },
  recording: {
    ready: 'ابدأ بصوتك',
    active: 'انتهيت من القراءة',
    preparing: 'نجهّز المساحة الصوتية',
    finishing: 'لحظة قصيرة، نكمل بعدها',
  },
  teaching: {
    read: 'أقرأ بصوتي',
    trace: 'أتتبّع بهدوء',
    cue: 'مساعدة لطيفة',
    next: 'ننتقل للخطوة التالية',
    reset: 'نبدأ من جديد',
  },
  boundary: {
    synthetic: 'مادة تدريبية تجريبية — ليست نتيجة حقيقية',
    adultOnly: 'تظهر هذه المعلومة للشخص المرافق للتأكد من حدود المادة.',
  },
  states: {
    waiting: 'ننتظر الخطوة المناسبة.',
    calmRetry: 'نأخذ وقتنا ونجرّب مرة أخرى.',
    saved: 'حُفظت هذه المحاولة، ونكمل معًا.',
    empty: 'لا توجد خطوة جاهزة الآن.',
  },
} as const

export type ChildCopy = typeof childCopy
