import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function AppError({
  title = "Sela needs your attention",
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <Alert className="mb-4 rounded-md">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="pr-20">{message}</AlertDescription>
      {onRetry ? (
        <Button
          className="absolute top-2 right-2"
          size="sm"
          variant="outline"
          onClick={onRetry}
        >
          Try again
        </Button>
      ) : null}
    </Alert>
  )
}
