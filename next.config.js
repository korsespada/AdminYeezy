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
    // Сборка идёт на сервере рядом с прод-контейнерами (4 ядра / 5.8 ГБ RAM):
    // ограничиваем число воркеров сборки и память Turbopack, иначе деплой
    // вымывает память у Elasticsearch и Postgres, и сервер перестаёт отвечать.
    cpus: 2,
    // 1.5 ГБ в байтах — потолок движка Turbopack при next build.
    turbopackMemoryLimit: 1610612736,
  },
}

module.exports = nextConfig
