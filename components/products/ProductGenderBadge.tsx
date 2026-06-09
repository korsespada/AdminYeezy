interface ProductGenderBadgeProps {
  gender?: string
  className?: string
}

function normalizeGenderLabel(gender?: string) {
  if (!gender) return ''
  if (gender === 'male') return 'Мужчин'
  if (gender === 'female') return 'Женщин'
  if (gender === 'unisex') return 'Унисекс'
  return gender.replace('Для ', '')
}

export default function ProductGenderBadge({ gender, className = '' }: ProductGenderBadgeProps) {
  const label = normalizeGenderLabel(gender)
  if (!label) return null

  const tone = gender === 'Для мужчин' || gender === 'male'
    ? 'bg-blue-900/30 text-blue-400 ring-blue-500/20'
    : gender === 'Для женщин' || gender === 'female'
      ? 'bg-pink-900/30 text-pink-400 ring-pink-500/20'
      : 'bg-violet-900/30 text-violet-300 ring-violet-500/20'

  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ${tone} ${className}`}>
      {label}
    </span>
  )
}
