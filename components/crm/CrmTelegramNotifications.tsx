import Link from 'next/link'
import { BellRing, Send, Trash2, UserPlus } from 'lucide-react'
import {
  createTelegramNotificationRecipientAction,
  deleteTelegramNotificationRecipientAction,
  testTelegramNotificationRecipientAction,
  updateTelegramNotificationRecipientAction,
} from '@/actions/telegram-notifications'
import { Button } from '@/components/ui/button'
import { type RailsTelegramNotificationRecipient } from '@/lib/rails-admin'

export default function CrmTelegramNotifications({ recipients }: { recipients: RailsTelegramNotificationRecipient[] }) {
  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">CRM</Link>
          <div className="mt-4 flex items-center gap-3"><BellRing className="h-8 w-8 text-violet-300" /><h1 className="text-3xl font-bold text-white sm:text-4xl">Настройки CRM</h1></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Укажите получателей. Каждый активный получатель получает все уведомления о новых клиентах и заказах.</p>
        </header>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-sky-300" /><h2 className="text-lg font-semibold text-white">Добавить получателя</h2></div>
          <form action={createTelegramNotificationRecipientAction} className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <Field label="Название"><input name="label" placeholder="Например, Александр" className={inputClassName} /></Field>
            <Field label="Идентификатор Telegram"><input name="telegramId" inputMode="numeric" required placeholder="370560940" className={inputClassName} /></Field>
            <Button type="submit" className="bg-sky-600 text-white hover:bg-sky-500">Добавить</Button>
          </form>
        </section>

        <section className="space-y-4">
          {recipients.map((recipient) => (
            <article key={recipient.id} className="rounded-lg border border-slate-800 bg-slate-900 p-5">
              <form action={updateTelegramNotificationRecipientAction} className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                <input type="hidden" name="id" value={recipient.id} />
                <Field label="Название"><input name="label" defaultValue={recipient.label || ''} className={inputClassName} /></Field>
                <Field label="Идентификатор Telegram"><input name="telegramId" inputMode="numeric" required defaultValue={recipient.telegram_id} className={inputClassName} /></Field>
                <Button type="submit" className="bg-slate-100 text-slate-950 hover:bg-white">Сохранить</Button>
              </form>
              <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-800 pt-4">
                <form action={testTelegramNotificationRecipientAction}><input type="hidden" name="id" value={recipient.id} /><Button type="submit" variant="outline" className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800"><Send className="mr-2 h-4 w-4" />Отправить тест</Button></form>
                <form action={deleteTelegramNotificationRecipientAction}><input type="hidden" name="id" value={recipient.id} /><Button type="submit" variant="outline" className="border-red-900 bg-transparent text-red-300 hover:bg-red-950"><Trash2 className="mr-2 h-4 w-4" />Удалить</Button></form>
              </div>
            </article>
          ))}
          {recipients.length === 0 && <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center text-slate-400">Получателей пока нет. Добавьте идентификатор Telegram выше.</div>}
        </section>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium text-slate-300">{label}{children}</label>
}

const inputClassName = 'h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-500'
