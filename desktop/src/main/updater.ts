import { UPDATE_FEED_URL } from './config';

/**
 * Auto-update, off unless a feed is configured.
 *
 * It cannot be meaningfully tested without signed builds, and signing requires an Apple Developer
 * identity and an Authenticode certificate this repository does not hold
 * (docs/Phase13_DesktopAgent_Implementation_Plan.md §9). Rather than ship an update path nobody
 * has ever watched run, it stays behind DESKTOP_UPDATE_FEED_URL: unset means no update code runs
 * at all, and the import is dynamic so the module is not even loaded.
 */
export async function initAutoUpdate(): Promise<void> {
  if (!UPDATE_FEED_URL) return;

  const { autoUpdater } = await import('electron-updater');
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
  autoUpdater.autoDownload = true;
  // Never restart under someone mid-session: the update is applied on the next launch.
  autoUpdater.autoInstallOnAppQuit = true;
  await autoUpdater.checkForUpdates();
}
