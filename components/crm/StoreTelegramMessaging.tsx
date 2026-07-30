import Link from 'next/link'
import { Image as ImageIcon, Send, Users } from 'lucide-react'
import { createStoreTelegramCampaignAction } from '@/actions/store-telegram'
import { Button } from '@/components/ui/button'
import {
  type RailsStoreTelegramCampaign,
  type RailsStoreTelegramContact,
} from '@/lib/rails-admin'

interface Props {
  contacts: RailsStoreTelegramContact[]
  total: number
  campaigns: RailsStoreTelegramCampaign[]
}

export default function StoreTelegramMessaging({ contacts, total, campaigns }: Props) {
  const activeContacts = contacts.filter((contact) => contact.status === 'active')

  return (
    <main className="min-h-full bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header>
          <Link href="/admin/crm" className="text-sm font-medium text-sky-300 hover:text-sky-200">CRM</Link>
          <div className="mt-4 flex items-center gap-3">
            <Send className="h-8 w-8 text-sky-300" />
            <h1 className="text-3xl font-bold text-white sm:text-4xl">Telegram-сообщения</h1>
          </div>
          <p className="mt-3 text-sm text-slate-400">
            Получателей: {total}, доступны для отправки: {activeContacts.length}.
            Бот может написать только тем, кто уже взаимодействовал с ним.
          </p>
        </header>

        <form
          action={createStoreTelegramCampaignAction}
          className="grid gap-6 rounded-lg border border-slate-800 bg-slate-900 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]"
        >
          <div className="space-y-5">
            <h2 className="text-xl font-semibold">Новое сообщение</h2>
            <Field label="Название рассылки">
              <input name="title" required placeholder="Летняя акция" className={inputClassName} />
            </Field>
            <Field label="Текст сообщения (поддерживается Telegram HTML)">
              <textarea name="body" required rows={8} placeholder="<b>Новая коллекция</b> уже на сайте" className={inputClassName} />
            </Field>
            <details className="rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              <summary className="cursor-pointer font-medium text-sky-300">
                Подсказка по HTML-разметке
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <code>&lt;b&gt;жирный&lt;/b&gt;</code>
                <code>&lt;i&gt;курсив&lt;/i&gt;</code>
                <code>&lt;u&gt;подчёркнутый&lt;/u&gt;</code>
                <code>&lt;s&gt;зачёркнутый&lt;/s&gt;</code>
                <code>&lt;tg-spoiler&gt;скрытый текст&lt;/tg-spoiler&gt;</code>
                <code>&lt;a href=&quot;https://...&quot;&gt;ссылка&lt;/a&gt;</code>
                <code>&lt;code&gt;YOU10&lt;/code&gt;</code>
                <code>&lt;blockquote&gt;цитата&lt;/blockquote&gt;</code>
              </div>
              <p className="mt-3">
                Символы вне тегов экранируйте: &amp;lt; для &lt;, &amp;gt; для &gt; и &amp;amp; для &amp;.
              </p>
            </details>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Тип медиа">
                <select name="mediaType" className={inputClassName} defaultValue="none">
                  <option value="none">Без медиа</option>
                  <option value="photo">Фото</option>
                  <option value="video">Видео</option>
                </select>
              </Field>
              <Field label="Загрузить фото или видео">
                <input name="media" type="file" accept="image/*,video/*" className={fileClassName} />
              </Field>
            </div>
            <Field label="Или публичный URL / Telegram file_id">
              <input name="mediaUrl" placeholder="https://static.yeezyunique.ru/..." className={inputClassName} />
            </Field>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-violet-300" />
                  <h3 className="font-medium">Кнопки</h3>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  Кнопок в строке
                  <select name="buttonColumns" defaultValue="1" className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-white">
                    <option value="1">1</option>
                    <option value="2">2</option>
                  </select>
                </label>
              </div>
              {[1, 2, 3].map((index) => (
                <div key={index} className="mb-3 grid gap-3 rounded-md border border-slate-800 p-3 sm:grid-cols-2">
                  <input name={`buttonText${index}`} placeholder={`Текст кнопки ${index}`} className={inputClassName} />
                  <input name={`buttonUrl${index}`} type="url" placeholder="https://..." className={inputClassName} />
                  <label className="grid gap-1 text-xs text-slate-400">
                    Цвет кнопки
                    <select name={`buttonStyle${index}`} defaultValue="" className={inputClassName}>
                      <option value="">Обычный</option>
                      <option value="primary">Синий — основное действие</option>
                      <option value="success">Зелёный — успешное действие</option>
                      <option value="danger">Красный — опасное действие</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                    <input name={`buttonWebApp${index}`} type="checkbox" className="accent-sky-500" />
                    Открывать как Telegram Mini App
                  </label>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                Цвета поддерживаются Telegram для подходящих ботов и клиентов; отображение зависит от темы пользователя.
                Mini App-кнопка работает в личном чате с ботом.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-300" />
              <h2 className="text-lg font-semibold">Получатели</h2>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="audience" value="all" defaultChecked className="accent-sky-500" />
              Все активные ({activeContacts.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="audience" value="selected" className="accent-sky-500" />
              Только отмеченные
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="audience" value="direct" className="accent-sky-500" />
              По Telegram ID
            </label>
            <Field label="Telegram ID для теста">
              <input
                name="telegramIds"
                inputMode="numeric"
                placeholder="370560940"
                className={inputClassName}
              />
            </Field>
            <div className="max-h-[470px] space-y-2 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-3">
              {activeContacts.map((contact) => (
                <label key={contact.id} className="flex items-start gap-3 rounded p-2 text-sm hover:bg-slate-900">
                  <input name="contactIds" value={contact.id} type="checkbox" className="mt-1 accent-sky-500" />
                  <span>
                    <span className="block font-medium text-white">{contact.display_name}</span>
                    <span className="text-xs text-slate-500">
                      {contact.username ? `@${contact.username}` : contact.telegram_id}
                    </span>
                  </span>
                </label>
              ))}
              {activeContacts.length === 0 && <p className="p-3 text-sm text-slate-500">Контактов пока нет.</p>}
            </div>
            <Button type="submit" className="w-full bg-sky-600 text-white hover:bg-sky-500">
              <Send className="mr-2 h-4 w-4" />
              Создать и отправить
            </Button>
          </div>
        </form>

        <section>
          <h2 className="mb-4 text-xl font-semibold">История рассылок</h2>
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <article key={campaign.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{campaign.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-400">{campaign.body}</p>
                  </div>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{campaign.status}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                  <span>Всего: {campaign.deliveries.total}</span>
                  <span className="text-emerald-300">Отправлено: {campaign.deliveries.sent}</span>
                  <span className="text-amber-300">В очереди: {campaign.deliveries.pending}</span>
                  <span className="text-red-300">Ошибки: {campaign.deliveries.failed}</span>
                </div>
              </article>
            ))}
            {campaigns.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-slate-500">
                Рассылок пока нет.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium text-slate-300">{label}{children}</label>
}

const inputClassName = 'min-h-10 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-sky-500'
const fileClassName = 'block min-h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-sky-700 file:px-3 file:py-1 file:text-white'
