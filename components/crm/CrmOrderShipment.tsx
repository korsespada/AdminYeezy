import { Truck } from 'lucide-react'
import { ShipmentAddForm, ShipmentPanel } from '@/components/crm/CrmShipment'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type RailsCrmOrderDetail } from '@/lib/rails-admin'

const trackableStatuses = ['paid', 'shipped', 'delivered']

// Трек-номер STD у заказа сайта. Номер выдаёт STD, менеджер вводит его
// вручную: оплаченный заказ переходит в «Отправлен», клиент получает трек в
// Telegram-боте и видит статус посылки в ЛК.
export default function CrmOrderShipment({ order }: { order: RailsCrmOrderDetail }) {
  const orderId = String(order.id)
  const customerId = order.customer?.id ? String(order.customer.id) : undefined

  return (
    <Card className="border-slate-800 bg-slate-900 text-slate-100">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4 text-sky-300" />Трек STD</CardTitle>
        {!order.shipment && trackableStatuses.includes(order.status) && (
          <CardDescription className="text-slate-500">
            {order.status === 'paid'
              ? 'Заказ перейдёт в «Отправлен», клиент получит трек в Telegram-боте и увидит статус в ЛК.'
              : 'Клиент увидит статус посылки в ЛК.'}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {order.shipment
          ? <ShipmentPanel shipment={order.shipment} orderId={orderId} customerId={customerId} />
          : trackableStatuses.includes(order.status)
            ? <ShipmentAddForm orderId={orderId} customerId={customerId} />
            : <p className="text-sm text-slate-500">Трек можно добавить после оплаты заказа.</p>}
      </CardContent>
    </Card>
  )
}
