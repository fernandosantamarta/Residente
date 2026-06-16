import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Support · Residente',
  description: 'Get help with Residente — how to sign in, manage notifications, pay dues, and contact your community board or the Residente team.',
}

export default function Support() {
  return (
    <LegalPage title="Support" updated="June 16, 2026">
      <p>
        Need a hand with Residente? Most questions are answered below. If you
        can&rsquo;t find what you need, email us at{' '}
        <a href="mailto:hello@residente.io">hello@residente.io</a> and we&rsquo;ll
        get back to you.
      </p>

      <h2>Getting access</h2>
      <p>
        Residente is provided through your homeowners&rsquo; or condo association.
        Your community&rsquo;s board or manager invites you, or shares a join
        link/QR code. Sign in with the email your association has on file. If you
        can&rsquo;t sign in, contact your board first &mdash; they manage who has
        access to your community.
      </p>

      <h2>Common questions</h2>
      <ul>
        <li>
          <strong>I forgot my password.</strong> Tap &ldquo;Forgot password&rdquo;
          on the sign-in screen to reset it by email.
        </li>
        <li>
          <strong>How do I pay my dues?</strong> Open <strong>Easy Track</strong>,
          review your balance, and follow the prompts to pay. Payments are
          processed securely by Stripe.
        </li>
        <li>
          <strong>How do I turn notifications on or off?</strong> Go to{' '}
          <strong>Settings &rarr; Notifications</strong> to choose what you&rsquo;re
          notified about. On iPhone, you can also manage permission in the system
          Settings app under Residente.
        </li>
        <li>
          <strong>How do I reach my board?</strong> Use <strong>Easy Voice</strong>
          {' '}to message the board, ask a question, or submit a maintenance request.
          You&rsquo;ll be notified when they reply.
        </li>
        <li>
          <strong>Where are my community&rsquo;s documents and rules?</strong> In{' '}
          <strong>Easy Documents</strong> &mdash; governing documents, rules, and
          notices, all in one place.
        </li>
      </ul>

      <h2>Contact us</h2>
      <p>
        For anything else &mdash; account issues, bugs, or feedback &mdash; email{' '}
        <a href="mailto:hello@residente.io">hello@residente.io</a>. For questions
        specific to your community (dues amounts, rules, approvals), your board or
        manager is the best first point of contact.
      </p>

      <h2>Privacy &amp; terms</h2>
      <p>
        See our <a href="/privacy">Privacy Policy</a> and{' '}
        <a href="/terms">Terms of Service</a>.
      </p>
    </LegalPage>
  )
}
