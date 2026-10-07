import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import React from 'react';
import { ArrowLeft, Database, Eye, Fingerprint, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';

const POLICY_UPDATED = 'July 23, 2026';

export default function ConfidentialityPage({ onBack }) {
  useLocale();
  return (
    <article className="confidentiality-page" aria-labelledby="confidentiality-title">
      <button type="button" className="admin-back" onClick={onBack}><ArrowLeft size={14} /> {translate("Back to Procedural Planets")}</button>
      <header className="confidentiality-hero">
        <span className="confidentiality-icon"><ShieldCheck size={22} aria-hidden /></span>
        <div>
          <span>{translate("Legal & privacy")}</span>
          <h1 id="confidentiality-title">{translate("Confidentiality & privacy")}</h1>
          <p>{translate("How Procedural Planets protects account, project, and usage information.")}</p>
          <small>{translate("Last updated {0}", { 0: translate(POLICY_UPDATED) })}</small>
        </div>
      </header>

      <section className="confidentiality-summary" aria-label={translate("Privacy summary")}>
        <div><LockKeyhole size={17} /><strong>{translate("Private by default")}</strong><span>{translate("Your planets stay private unless you choose otherwise.")}</span></div>
        <div><Fingerprint size={17} /><strong>{translate("No raw IP storage")}</strong><span>{translate("Network addresses are converted to rotating one-way identifiers.")}</span></div>
        <div><Eye size={17} /><strong>{translate("Limited access")}</strong><span>{translate("Administrative data is available only to authorized administrators.")}</span></div>
      </section>

      <div className="confidentiality-body">
        <section>
          <h2>{translate("Information we process")}</h2>
          <p>{translate("We process the information needed to provide the service: your email address, username, profile settings, password hash, active sessions, and planets you choose to sync. Passwords are never stored in readable form.")}</p>
          <p>{translate("For reliability, security, and product analytics, we record page paths, visit time, referral host, limited browser/device information, authentication outcomes, and a rotating one-way network identifier. The service does not store raw IP addresses in analytics or security logs.")}</p>
        </section>
        <section>
          <h2>{translate("How information is used")}</h2>
          <p>{translate("Information is used to authenticate accounts, save and share planets, operate the community gallery, measure service usage, investigate abuse, and maintain an accountable record of administrator actions. It is not sold or used for third-party advertising.")}</p>
        </section>
        <section>
          <h2>{translate("Visibility and confidentiality")}</h2>
          <p>{translate("New planets are private by default. Unlisted planets are accessible to people with their link. Public planets may appear in the community gallery. Administrators can view planet metadata for service operations, but the dashboard intentionally does not expose private planet content.")}</p>
        </section>
        <section>
          <h2>{translate("Retention")}</h2>
          <div className="confidentiality-retention">
            <span><Database size={14} /><strong>{translate("Visit analytics")}</strong> {translate("deleted after 90 days")}</span>
            <span><Database size={14} /><strong>{translate("Security events")}</strong> {translate("deleted after 180 days")}</span>
            <span><Database size={14} /><strong>{translate("Admin audit events")}</strong> {translate("deleted after 1 year")}</span>
          </div>
          <p>{translate("Retention cleanup runs when the service starts and hourly thereafter. Account and planet data are kept while the account is active or as required to provide the service. Expired sessions are removed automatically.")}</p>
        </section>
        <section>
          <h2>{translate("Security")}</h2>
          <p>{translate("Procedural Planets uses HTTP-only secure session cookies in production, strict origin checks, rate limits, server-side role authorization, one-way password hashing, session revocation, and audit logging. No internet service can guarantee absolute security, so suspected incidents should be reported promptly.")}</p>
        </section>
        <section>
          <h2>{translate("Your choices")}</h2>
          <p>{translate("You can choose each planet's visibility, edit your profile, change your password, and sign out to invalidate your current session. To request access, correction, or deletion of account information, contact the project maintainer.")}</p>
          <a className="confidentiality-contact" href="mailto:zyfodexe@gmail.com"><Mail size={15} /> zyfodexe@gmail.com</a>
        </section>
      </div>
    </article>
  );
}
