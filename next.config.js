/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'noindex, nofollow',
          },
        ],
      },
    ]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Разделы админки читают Rails и scraping-БД на каждый заход, поэтому
    // переход между разделами ждал сервер целиком. 30 секунд клиентского
    // кеша делают возврат в недавно открытый раздел мгновенным; правки
    // инвалидируют его сами (revalidatePath в server actions + router.refresh).
    staleTimes: {
      dynamic: 30,
    },
    // Наведение или касание ссылки догружает раздел заранее: клик открывает
    // уже готовую страницу вместо ожидания полного запроса.
    dynamicOnHover: true,
    // Сборка идёт на сервере рядом с прод-контейнерами (4 ядра / 5.8 ГБ RAM):
    // ограничиваем число воркеров сборки и память Turbopack, иначе деплой
    // вымывает память у Elasticsearch и Postgres, и сервер перестаёт отвечать.
    cpus: 2,
    // 1.5 ГБ в байтах — потолок движка Turbopack при next build.
    turbopackMemoryLimit: 1610612736,
  },
}

module.exports = nextConfig
