/* Admin panel behaviour: custom-colour toggle, live swatch, confirm prompts. */
(function () {
	'use strict';

	var custom = document.querySelector('.fb-custom');
	if (custom) {
		var swatch = document.querySelector('.fb-swatch[data-scheme="custom"]');
		var toggle = function () {
			var checked = document.querySelector('.fb-scheme input:checked');
			custom.hidden = !(checked && checked.value === 'custom');
		};
		document.querySelectorAll('.fb-scheme input').forEach(function (r) { r.addEventListener('change', toggle); });
		custom.querySelectorAll('input[type="color"]').forEach(function (input) {
			input.addEventListener('input', function () {
				if (swatch) { swatch.style.setProperty('--fb-' + input.dataset.token, input.value); }
			});
		});
		toggle();
	}

	document.querySelectorAll('form[data-confirm]').forEach(function (form) {
		form.addEventListener('submit', function (e) {
			if (!window.confirm(form.dataset.confirm)) { e.preventDefault(); }
		});
	});
})();
