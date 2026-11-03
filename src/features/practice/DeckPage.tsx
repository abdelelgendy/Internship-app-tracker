import { useParams } from 'react-router'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function DeckPage() {
  const { deckId } = useParams()
  return (
    <>
      <PageHeader
        title="Deck"
        description={
          <>
            Review the cards in deck <span className="font-mono break-all">{deckId}</span>.
          </>
        }
      />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
