import VideoMatchesTabs from '@/components/video-matches/VideoMatchesTabs'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default function VideoMatchesPage() {
  return (
    <div className="p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <ImportTabs />
        <VideoMatchesTabs />
      </div>
    </div>
  )
}
