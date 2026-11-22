export const PROJECT_DRAFT_ERRORS = {
  "serverError.projectDraft.unreadable": "This project's timeline couldn't be read, so nothing was changed. Restore its file in the project-timelines folder of MagicBot's data folder from a backup, then try again.",
  "serverError.projectDraft.orderInvalid": "Give the shots as a list of their ids, each one once.",
  "serverError.projectDraft.unknownShot": "{shot} isn't a shot of this project.",
  "serverError.projectDraft.remote": "The JianYing draft is on the computer this project runs on. Open JianYing there.",
  "serverError.projectDraft.notInstalled": "JianYing Pro wasn't found on this computer. Install it, open it once, then try again.",
  "serverError.projectDraft.unsupportedVersion": "This version of JianYing Pro isn't supported yet, so no draft is written for it.",
  "serverError.projectDraft.openFailed": "JianYing didn't open. Open it yourself.",
  "serverError.projectDraft.notVideo": "That file isn't a video, so it can't be the finished film.",
} as const;
