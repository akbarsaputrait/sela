export type CaptureSubmission = Readonly<{
  generation: number
  draftRevision: number
}>

/** Keeps one native save alive even when its capture window is closed or reopened. */
export class CaptureLifecycle {
  private generation = 0
  private open = true
  private saved = false
  private submission: CaptureSubmission | null = null
  private draftRevision = 0

  get isOpen() {
    return this.open
  }

  get isSubmitting() {
    return this.submission !== null
  }

  get currentGeneration() {
    return this.generation
  }

  openCapture() {
    this.open = true
    this.generation += 1
    this.saved = false
  }

  closeCapture() {
    this.open = false
    this.generation += 1
    this.saved = false
  }

  isCurrent(generation: number) {
    return this.open && generation === this.generation
  }

  draftChanged() {
    this.draftRevision += 1
  }

  isSubmittedDraft(submission: CaptureSubmission) {
    return submission.draftRevision === this.draftRevision
  }

  beginSubmission(): CaptureSubmission | null {
    if (!this.open || this.saved || this.submission !== null) return null
    const submission = {
      generation: this.generation,
      draftRevision: this.draftRevision,
    }
    this.submission = submission
    return submission
  }

  finishSubmission(submission: CaptureSubmission, succeeded: boolean) {
    if (this.submission !== submission) return false
    this.submission = null
    const current = this.isCurrent(submission.generation)
    if (current && succeeded) this.saved = true
    return current
  }
}
