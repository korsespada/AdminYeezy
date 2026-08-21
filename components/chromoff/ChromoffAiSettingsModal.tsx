'use client'

import { useState, useTransition } from 'react'
import { Bot, Save, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { updateChromoffAiSettingsAction } from '@/actions/chromoff-ai'
import type { ChromoffAiSettings } from '@/lib/chromoff-ai'
import type { BatchAiProvider } from '@/lib/batch-ai'

export default function ChromoffAiSettingsModal({
  settings: initialSettings,
}: {
  settings: ChromoffAiSettings
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [settings, setSettings] = useState(initialSettings)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateChromoffAiSettingsAction(settings)
      if (result.success) {
        setIsOpen(false)
      } else {
        alert(result.error)
      }
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-11 border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white">
          <Bot className="mr-2 h-4 w-4 text-emerald-400" />
          Настройки AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl border-slate-700 bg-slate-900 text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-xl">Настройки AI SEO для Chromoff</DialogTitle>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-300">Провайдер</label>
              <select
                value={settings.provider}
                onChange={(e) => setSettings({ ...settings, provider: e.target.value as BatchAiProvider })}
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="byesu">Byesu</option>
                <option value="cockpit">Cockpit (Yeezy)</option>
              </select>
            </div>
            
            {settings.provider === 'openrouter' && (
              <div>
                <label className="text-sm font-medium text-slate-300">Модель OpenRouter</label>
                <input
                  type="text"
                  value={settings.openrouterModel}
                  onChange={(e) => setSettings({ ...settings, openrouterModel: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}
            
            {settings.provider === 'byesu' && (
              <div>
                <label className="text-sm font-medium text-slate-300">Модель Byesu</label>
                <select
                  value={settings.byesuModel}
                  onChange={(e) => setSettings({ ...settings, byesuModel: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                  <option value="gpt-5.6-luna">GPT 5.6 Luna</option>
                </select>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-300">Температура</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={settings.temperature}
                  onChange={(e) => setSettings({ ...settings, temperature: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-300">Конкурентность (потоки)</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={settings.concurrency}
                  onChange={(e) => setSettings({ ...settings, concurrency: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            
            <div>
              <label className="text-sm font-medium text-slate-300">Системный промпт</label>
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => setSettings({ ...settings, systemPrompt: e.target.value })}
                rows={10}
                className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-3 border-t border-slate-700 pt-4">
          <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Отмена</Button>
          <Button type="button" onClick={handleSave} disabled={isPending} className="bg-emerald-600 hover:bg-emerald-500">
            {isPending ? 'Сохранение...' : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Сохранить
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
