import { translate } from '../i18n/locale.js';
import { useLocale } from '../i18n/useLocale.js';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Eye, Globe2, KeyRound, Lock, Save, Trash2, UserRound } from 'lucide-react';
import { avatarUrl } from './authApi.js';
import { useAuth } from './AuthContext.jsx';
import { usePopup } from '../components/ui/PopupProvider.jsx';

const MAX_AVATAR_BYTES = 1_048_576;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default function ProfilePage({ onBack }) {
  useLocale();
  const { user, updateProfile, updateAvatar, removeAvatar, changePassword } = useAuth();
  const { showPopup } = usePopup();
  const fileRef = useRef(null);
  const [details, setDetails] = useState({ username: '', displayName: '', websiteUrl: '', defaultProjectVisibility: 'private' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [detailsErrors, setDetailsErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!user) return;
    setDetails({
      username: user.username ?? '',
      displayName: user.displayName ?? '',
      websiteUrl: user.websiteUrl ?? '',
      defaultProjectVisibility: user.defaultProjectVisibility ?? 'private',
    });
  }, [user]);

  const changeDetails = (event) => {
    const { name, value } = event.target;
    setDetails((current) => ({ ...current, [name]: value }));
    setDetailsErrors((current) => ({ ...current, [name]: undefined }));
  };

  const changePasswords = (event) => {
    const { name, value } = event.target;
    setPasswords((current) => ({ ...current, [name]: value }));
    setPasswordErrors((current) => ({ ...current, [name]: undefined }));
  };

  const saveDetails = async (event) => {
    event.preventDefault();
    setBusy('details');
    setDetailsErrors({});
    try {
      await updateProfile(details);
      showPopup(translate('Profile settings saved.'), { type: 'success' });
    } catch (error) {
      setDetailsErrors(error.fields ?? {});
      showPopup(error.message || translate('Could not save your profile.'), { type: 'error', title: translate('Profile not saved') });
    } finally {
      setBusy('');
    }
  };

  const savePassword = async (event) => {
    event.preventDefault();
    const errors = {};
    if (passwords.newPassword !== passwords.confirmPassword) errors.confirmPassword = translate('Passwords do not match.');
    if (errors.confirmPassword) {
      setPasswordErrors(errors);
      return;
    }
    setBusy('password');
    setPasswordErrors({});
    try {
      await changePassword({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      showPopup(translate('Password changed. Your other sessions were signed out.'), { type: 'success' });
    } catch (error) {
      setPasswordErrors(error.fields ?? {});
      showPopup(error.message || translate('Could not change your password.'), { type: 'error', title: translate('Password not changed') });
    } finally {
      setBusy('');
    }
  };

  const chooseAvatar = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.has(file.type)) {
      showPopup(translate('Choose a PNG, JPEG, or WebP image.'), { type: 'error', title: translate('Unsupported image') });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      showPopup(translate('Profile pictures must be 1 MB or smaller.'), { type: 'error', title: translate('Image is too large') });
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showPopup(translate('Could not read this image.'), { type: 'error' });
    reader.onload = async () => {
      setBusy('avatar');
      try {
        await updateAvatar(reader.result);
        showPopup(translate('Profile picture updated.'), { type: 'success' });
      } catch (error) {
        showPopup(error.fields?.avatar || error.message || translate('Could not update your profile picture.'), { type: 'error' });
      } finally {
        setBusy('');
      }
    };
    reader.readAsDataURL(file);
  };

  const deleteAvatar = async () => {
    setBusy('avatar');
    try {
      await removeAvatar();
      showPopup(translate('Profile picture removed.'), { type: 'success' });
    } catch (error) {
      showPopup(error.message || translate('Could not remove your profile picture.'), { type: 'error' });
    } finally {
      setBusy('');
    }
  };

  const field = (name, label, props = {}) => (
    <label className={`auth-field${detailsErrors[name] ? ' has-error' : ''}`}>
      <span>{translate(label)}</span>
      <input name={name} value={details[name]} onChange={changeDetails} disabled={busy === 'details'} aria-invalid={!!detailsErrors[name]} {...props} />
      {detailsErrors[name] && <small>{translate(detailsErrors[name])}</small>}
    </label>
  );

  const passwordField = (name, label, autoComplete) => (
    <label className={`auth-field${passwordErrors[name] ? ' has-error' : ''}`}>
      <span>{translate(label)}</span>
      <input type="password" name={name} value={passwords[name]} onChange={changePasswords} autoComplete={autoComplete} minLength={name === 'currentPassword' ? undefined : 10} maxLength={128} required disabled={busy === 'password'} aria-invalid={!!passwordErrors[name]} />
      {passwordErrors[name] && <small>{translate(passwordErrors[name])}</small>}
    </label>
  );

  const picture = avatarUrl(user);
  const initials = (user?.displayName || user?.username || '?').slice(0, 2).toUpperCase();

  return (
    <section className="profile-page" aria-labelledby="profile-title">
      <button type="button" className="auth-back" onClick={onBack}><ArrowLeft size={14} /> {translate("Back to projects")}</button>
      <header className="profile-heading">
        <div><span>{translate("Account settings")}</span><h1 id="profile-title">{translate("Your profile")}</h1><p>{translate("Manage how you appear and set defaults for projects you create.")}</p></div>
      </header>

      <div className="profile-grid">
        <section className="profile-card profile-avatar-card">
          <header><Camera size={16} /><div><h2>{translate("Profile picture")}</h2><p>{translate("PNG, JPEG or WebP, up to 1 MB.")}</p></div></header>
          <div className="profile-avatar-row">
            <span className="profile-avatar">{picture ? <img src={picture} alt={translate("Your profile")} /> : initials}</span>
            <div className="profile-avatar-actions">
              <button type="button" className="lp-primary sm" onClick={() => fileRef.current?.click()} disabled={busy === 'avatar'}><Camera size={13} /> {picture ? translate('Replace') : translate('Upload')}</button>
              {picture && <button type="button" className="profile-danger-button" onClick={deleteAvatar} disabled={busy === 'avatar'}><Trash2 size={13} /> {translate("Remove")}</button>}
            </div>
            <input ref={fileRef} className="profile-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} />
          </div>
        </section>

        <section className="profile-card profile-details-card">
          <header><UserRound size={16} /><div><h2>{translate("Profile information")}</h2><p>{translate("Your public identity and project defaults.")}</p></div></header>
          <form onSubmit={saveDetails} noValidate>
            <div className="profile-field-grid">
              {field('username', translate('Username'), { type: 'text', autoComplete: 'username', minLength: 3, maxLength: 32, required: true })}
              {field('displayName', translate('Display name'), { type: 'text', autoComplete: 'name', maxLength: 80, placeholder: translate('Planet artist') })}
            </div>
            <label className="auth-field"><span>{translate("Email")}</span><input value={user?.email ?? ''} type="email" readOnly aria-readonly="true" /><small className="profile-field-note">{translate("Email changes are not available yet.")}</small></label>
            {field('websiteUrl', translate('Website'), { type: 'url', autoComplete: 'url', maxLength: 2048, placeholder: 'https://example.com' })}
            <fieldset className={`profile-visibility${detailsErrors.defaultProjectVisibility ? ' has-error' : ''}`}>
              <legend>{translate("Default project visibility")}</legend>
              <div className="profile-visibility-options">
                <label><input type="radio" name="defaultProjectVisibility" value="private" checked={details.defaultProjectVisibility === 'private'} onChange={changeDetails} disabled={busy === 'details'} /><Lock size={14} /><span><strong>{translate("Private")}</strong><small>{translate("Only you can access it.")}</small></span></label>
                <label><input type="radio" name="defaultProjectVisibility" value="unlisted" checked={details.defaultProjectVisibility === 'unlisted'} onChange={changeDetails} disabled={busy === 'details'} /><Eye size={14} /><span><strong>{translate("Unlisted")}</strong><small>{translate("Anyone with its link can open it.")}</small></span></label>
                <label><input type="radio" name="defaultProjectVisibility" value="public" checked={details.defaultProjectVisibility === 'public'} onChange={changeDetails} disabled={busy === 'details'} /><Globe2 size={14} /><span><strong>{translate("Public")}</strong><small>{translate("Visible to everyone.")}</small></span></label>
              </div>
              {detailsErrors.defaultProjectVisibility && <small>{detailsErrors.defaultProjectVisibility}</small>}
            </fieldset>
            <button type="submit" className="lp-primary profile-save" disabled={busy === 'details'}><Save size={14} /> {busy === 'details' ? translate('Saving...') : translate('Save profile')}</button>
          </form>
        </section>

        <section className="profile-card profile-security-card">
          <header><KeyRound size={16} /><div><h2>{translate("Password")}</h2><p>{translate("Changing it signs out your other active sessions.")}</p></div></header>
          <form onSubmit={savePassword} noValidate>
            {passwordField('currentPassword', translate('Current password'), 'current-password')}
            <div className="profile-field-grid">
              {passwordField('newPassword', translate('New password'), 'new-password')}
              {passwordField('confirmPassword', translate('Confirm new password'), 'new-password')}
            </div>
            <button type="submit" className="lp-secondary profile-save" disabled={busy === 'password'}><KeyRound size={14} /> {busy === 'password' ? translate('Changing...') : translate('Change password')}</button>
          </form>
        </section>
      </div>
    </section>
  );
}
