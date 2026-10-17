import { defineConfig, type Plugin } from 'vitest/config';

/**
 * GJS resolves `gi://` imports to GObject introspection bindings, which do
 * not exist under Node. Tests reach them only through modules imported for
 * pure helpers (the license gate client's main entry loads its GLib, Gio
 * and Soup adapters next to its domain), so each `gi://` module is replaced
 * by an empty object; calling into one is a test bug. Vite leaves anything
 * shaped like a URL unresolved, so the specifiers are rewritten first.
 */
function stubGiModules(): Plugin {
	const prefix = 'virtual:gi-stub/';
	return {
		name: 'stub-gi-modules',
		enforce: 'pre',
		transform(code) {
			if (!code.includes('gi://')) {
				return null;
			}
			return code.replace(/(['"])gi:\/\/([^'"]*)\1/g, `$1${prefix}$2$1`);
		},
		resolveId(id) {
			return id.startsWith(prefix) ? `\0${id}` : null;
		},
		load(id) {
			return id.startsWith(`\0${prefix}`) ? 'export default {};' : null;
		},
	};
}

export default defineConfig({
	plugins: [stubGiModules()],
	test: {
		globals: true,
		environment: 'node',
		server: {
			deps: {
				// Run the package through the plugin above instead of letting
				// Node load it, so its `gi://` imports are stubbed.
				inline: ['@haco-studio/gnome-licensing'],
			},
		},
	},
	esbuild: {
		target: 'es2020',
	},
});
