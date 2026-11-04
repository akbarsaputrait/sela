// Development previews must never bypass onboarding in a native window.
export function isDashboardPreview(
  search: string,
  development: boolean,
  desktop: boolean
) {
  return (
    development &&
    !desktop &&
    new URLSearchParams(search).get("preview") === "dashboard"
  )
}
