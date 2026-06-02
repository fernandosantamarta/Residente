import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service · Residente',
  description: 'The terms that govern use of the Residente community-management platform by residents, boards, and managers.',
}

export default function TermsOfService() {
  return (
    <LegalPage title="Terms of Service" updated="June 2, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Residente, a platform for
        running homeowners&rsquo; and condominium associations. By creating an account or using the
        service, you agree to these Terms. If you are accepting on behalf of an association, you
        represent that you are authorized to bind it.
      </p>

      <h2>The service</h2>
      <p>
        Residente provides tools to manage community operations &mdash; dues and budgets, documents,
        meetings and voting, maintenance and violations, and resident communication. We offer the
        product free to start for boards and managers and always free for residents; paid features,
        if any, are described at sign-up or in the product before you are charged.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>You must provide accurate information and keep your login credentials secure.</li>
        <li>You are responsible for activity under your account.</li>
        <li>Board and management accounts may invite, manage, and remove residents within their own
          community and are responsible for using that access appropriately.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use Residente to violate any law or the governing documents of your association;</li>
        <li>Access data for a community you are not authorized to manage or belong to;</li>
        <li>Upload unlawful, infringing, or malicious content;</li>
        <li>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the service.</li>
      </ul>

      <h2>Payments and dues</h2>
      <p>
        Online payments of dues and fees are processed by Stripe and are subject to Stripe&rsquo;s
        terms. Your association sets dues, assessments, late fees, and interest in accordance with
        its governing documents and applicable law, including Florida Statutes Chapters 718 and 720.
        Residente provides the software to record and collect these amounts but is not the
        association, does not set assessment policy, and is not a party to the relationship between
        a resident and their association. Disputes about amounts owed should be raised with your
        association.
      </p>

      <h2>Your content</h2>
      <p>
        Your association and its members retain ownership of the data and documents you put into
        Residente. You grant us the limited rights needed to host, process, and display that
        content to operate the service. You are responsible for having the right to upload the
        content you provide.
      </p>

      <h2>Service availability</h2>
      <p>
        We work to keep Residente available and reliable but do not guarantee uninterrupted
        service. We may modify, suspend, or discontinue features, and we will give reasonable
        notice of material changes where practical.
      </p>

      <h2>Disclaimers</h2>
      <p>
        Residente is provided &ldquo;as is&rdquo; without warranties of any kind, to the fullest
        extent permitted by law. Residente is a software tool, not a law firm, accounting firm, or
        property manager, and nothing in the product is legal, financial, or tax advice.
        Associations are responsible for compliance with their governing documents and applicable
        statutes.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Residente will not be liable for indirect,
        incidental, or consequential damages, and our total liability for any claim relating to the
        service will not exceed the amounts you paid us for the service in the twelve months before
        the claim.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using Residente at any time. We may suspend or terminate access for violation
        of these Terms or to protect the service or other users. On termination, your association
        may request an export of its data, subject to the retention rules in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Florida, without regard to its
        conflict-of-laws rules. Any dispute will be brought in the state or federal courts located
        in Florida.
      </p>

      <h2>Changes to these Terms</h2>
      <p>
        We may update these Terms as the product evolves. When we make material changes we will
        update the date above and, where appropriate, notify you in the app. Continued use after a
        change means you accept the updated Terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms? Email us at{' '}
        <a href="mailto:hello@residente.io">hello@residente.io</a>.
      </p>

      <p className="legal-note">
        These Terms are a general template and not legal advice. Have counsel review them for your
        specific circumstances before relying on them.
      </p>
    </LegalPage>
  )
}
