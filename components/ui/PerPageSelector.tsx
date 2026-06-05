'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function PerPageSelector({ currentPerPage }: { currentPerPage: number }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const onChange = (value: string) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('perPage', value)
        params.set('page', '1') // reset to page 1
        router.push(pathname + '?' + params.toString())
    }

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 whitespace-nowrap">Товаров на стр:</span>
            <Select
                value={currentPerPage.toString()}
                onValueChange={onChange}
            >
                <SelectTrigger className="h-8 w-24 bg-slate-700 text-slate-200">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="40">40</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
