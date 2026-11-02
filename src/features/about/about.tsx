export function About({ version }: { version: string }) {
  return (
    <section aria-labelledby="about-title" className="sela-page">
      <header className="mb-5">
        <h1 id="about-title" className="sela-page-title">
          About Sela
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          A little space to remember.
        </p>
      </header>
      <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-6 gap-y-3 text-[13px]">
        <dt className="text-muted-foreground">Version</dt>
        <dd className="tabular-nums">{version}</dd>
        <dt className="text-muted-foreground">Created by</dt>
        <dd>
          <a
            className="underline underline-offset-4 hover:no-underline"
            href="https://github.com/akbarsaputrait"
            aria-label="@akbarsaputrait on GitHub"
          >
            @akbarsaputrait
          </a>
        </dd>
      </dl>
      <section
        className="mt-5 border-t pt-4"
        aria-labelledby="local-data-title"
      >
        <h2 id="local-data-title" className="text-[13px] font-medium">
          Privacy
        </h2>
        <p className="mt-1 max-w-[58ch] text-[13px] leading-5 text-muted-foreground">
          Reminders and settings stay on this Mac. No account or analytics.
        </p>
      </section>
      <p className="mt-3 max-w-[58ch] text-xs leading-5 text-muted-foreground">
        Keep Sela running for alerts. Overdue reminders appear after your Mac
        wakes. Apple Reminders sync isn’t available yet.
      </p>
    </section>
  )
}
