export const coreCopy = {
  brandName: 'بصيرة',
  brandAriaLabel: 'بصيرة — مساحة هادئة للقراءة',
  noorAlt: {
    welcome: 'نور في وضع الترحيب',
    listening: 'نور في وضع الاستماع',
    teaching: 'نور في وضع التعلّم',
    reading: 'نور في وضع القراءة',
    celebrating: 'نور في وضع الاحتفال',
    encouraging: 'نور في وضع التشجيع',
    curious: 'نور في وضع الفضول',
  },
  notices: {
    neutral: 'معلومة مهمة',
    positive: 'اكتمل الأمر',
    caution: 'نحتاج إلى انتباهك',
  },
  actions: {
    continue: 'متابعة',
    back: 'رجوع',
    retry: 'المحاولة مرة أخرى',
    close: 'إغلاق',
  },
} as const

export type CoreCopy = typeof coreCopy

export const noorPoses = [
  'welcome',
  'listening',
  'teaching',
  'reading',
  'celebrating',
  'encouraging',
  'curious',
] as const
