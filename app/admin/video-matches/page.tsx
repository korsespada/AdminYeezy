import VideoMatchesApp from '@/components/video-matches/VideoMatchesApp'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default function VideoMatchesPage() {
  return (
    <div className="p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <ImportTabs />
        <VideoMatchesApp />
      </div>
    </div>
  )
}
