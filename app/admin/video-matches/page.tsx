import VideoMatchesTabs from '@/components/video-matches/VideoMatchesTabs'
import ImportTabs from '@/components/ui/ImportTabs'

export const dynamic = 'force-dynamic'

export default function VideoMatchesPage() {
  return (
    <div className="p-4 sm:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8">
        <ImportTabs />
        <VideoMatchesTabs />
      </div>
    </div>
  )
}
