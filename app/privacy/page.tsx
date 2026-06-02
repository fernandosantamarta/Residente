import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy · Residente',
  description: 'How Residente collects, uses, and protects the information of residents, boards, and community managers.',
}

export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" updated="June 2, 2026">
      <p>
        Residente (&ldquo;Residente,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) provides software that helps
        homeowners&rsquo; and condominium associations run their communities &mdash; tracking dues,
        budgets, documents, voting, maintenance, and resident communication. This Privacy
        Policy explains what information we collect, how we use it, and the choices you have.
        It applies to residents, board members, and community managers who use the Residente
        web application and the marketing site at residente.io.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your name, email address, password (stored only as
          a salted hash), and the community you belong to. Board and management accounts also
          include their role within the association.
        </li>
        <li>
          <strong>Community and unit data.</strong> Information your association maintains in the
          product: unit and address records, ownership and tenancy details, dues balances and
          payment history, budgets, meeting minutes, votes, violations, architectural requests,
          and uploaded documents.
        </li>
        <li>
          <strong>Payment information.</strong> When dues or fees are paid online, payments are
          processed by our payment provider, Stripe. Residente does not store full card numbers
          or bank account numbers; we retain only a token and limited metadata (such as the last
          four digits, brand, and payment status) needed to show your payment history.
        </li>
        <li>
          <strong>Usage and device data.</strong> Standard log data such as IP address, browser
          type, pages viewed, and timestamps, used to keep the service secure and reliable.
        </li>
      </ul>

      <h2>How we use information</h2>
      <ul>
        <li>To operate the product &mdash; show your dues, budgets, documents, schedule, and notices.</li>
        <li>To process dues and fee payments and keep an accurate ledger for your association.</li>
        <li>To send transactional notifications you opt into (payment receipts, meeting and vote
          notices, maintenance updates) by in-app alert and, where enabled, email.</li>
        <li>To secure the service, prevent fraud and abuse, and meet legal and accounting
          obligations that apply to community associations.</li>
        <li>To improve the product and provide support.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information, and we do not use your community&rsquo;s
        data to train third-party advertising models.
      </p>

      <h2>How information is shared</h2>
      <p>
        Your data is visible to the people who run your community on a need-to-know basis &mdash;
        for example, board members and managers can see the roster and dues status for their own
        association, and residents can see their own household&rsquo;s records. We share data with
        service providers who help us run Residente (such as our hosting and database provider and
        Stripe for payments), each bound by contract to protect it. We may disclose information if
        required by law or to protect the rights and safety of users and the public. If Residente
        is involved in a merger or acquisition, data may transfer as part of that transaction,
        subject to this policy.
      </p>

      <h2>Data retention</h2>
      <p>
        We keep community and account data for as long as your association uses Residente, and as
        needed afterward to meet the recordkeeping requirements that apply to associations (such as
        financial and meeting records under Florida Statutes Chapters 718 and 720). You can request
        deletion of your personal account information as described below; some records may be
        retained where the association or the law requires it.
      </p>

      <h2>Security</h2>
      <p>
        Access is controlled per community and per role, data is encrypted in transit, and database
        access is restricted by row-level security so one community cannot read another&rsquo;s
        records. No system is perfectly secure, but we work to protect your information using
        industry-standard safeguards.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can review and update your name, contact details, and notification preferences in
          your account Settings.</li>
        <li>You can opt out of non-essential email notifications while still receiving in-app alerts.</li>
        <li>You can request a copy or deletion of your personal information by emailing us. We will
          honor applicable rights under Florida and U.S. law.</li>
      </ul>

      <h2>Children</h2>
      <p>
        Residente is intended for adults responsible for a household or association. It is not
        directed to children under 13, and we do not knowingly collect their information.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy as the product evolves. When we make material changes we will
        update the date above and, where appropriate, notify you in the app.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy? Email us at{' '}
        <a href="mailto:hello@residente.io">hello@residente.io</a>.
      </p>

      <p className="legal-note">
        This policy is a general template and not legal advice. Associations should have counsel
        review their privacy practices for their specific circumstances.
      </p>
    </LegalPage>
  )
}
