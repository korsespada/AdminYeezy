'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export default function PerPageSelector({ currentPerPage }: { currentPerPage: number }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const params = new URLSearchParams(searchParams.toString())
        params.set('perPage', e.target.value)
        params.set('page', '1') // reset to page 1
        router.push(pathname + '?' + params.toString())
    }

    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400 whitespace-nowrap">Товаров на стр:</span>
            <select
                value={currentPerPage.toString()}
                onChange={onChange}
                className="bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-md focus:ring-indigo-500 focus:border-indigo-500 block py-1 pl-2 pr-8"
            >
                <option value="40">40</option>
                <option value="100">100</option>
                <option value="500">500</option>
            </select>
        </div>
    )
}
