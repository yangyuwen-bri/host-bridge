import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Host Bridge | 热点故事编辑台',
  description: '从社会热点、志怪素材到视频号成片的独立编辑工作台。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
