/* Installer: show only the fields that belong to the chosen database engine. */
(function () {
	'use strict';

	var select = document.getElementById('fb-driver');
	if (!select) { return; }
	var groups = document.querySelectorAll('[data-for]');

	function sync() {
		groups.forEach(function (g) {
			g.hidden = g.getAttribute('data-for').split(' ').indexOf(select.value) === -1;
		});
		// PostgreSQL / MySQL have different default users; hint the port.
		var host = document.querySelector('input[name="db_host"]');
		if (host) { host.placeholder = select.value === 'pgsql' ? 'localhost or localhost:5432' : 'localhost or localhost:3306'; }
	}
	select.addEventListener('change', sync);
	sync();
})();
