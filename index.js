// index.js
import { mountTownMapEditor, setI18n as setEditorI18n } from './editor_ui.js';
import es from './locales/es.js';
let activeDialog = null;

export function activate(ctx) {

  setEditorI18n((s, v) => ctx.i18n.t(s, v));
  ctx.i18n.addTranslations("es", es);
  ctx.menu.registerMenuItem({
    menu: "Mods",
    label: ctx.i18n.t("Town Map Editor"),
    handler: () => {
    
      if (activeDialog) return;

      activeDialog = ctx.ui.showCustomDialog({
        title: ctx.i18n.t("Town Map Editor"),
        width: "800px",
        height: "600px",
        render: (body) => {

          const cleanup = mountTownMapEditor(ctx, body);


          return () => {
            if (typeof cleanup === 'function') {
              cleanup(); 
            }
            activeDialog = null;
          };
        }
      });
    }
  });

  ctx.log.info("Town Map Editor mod activated.");
}

export function deactivate() {

  if (activeDialog) {
    activeDialog.close();
    activeDialog = null;
  }
}
