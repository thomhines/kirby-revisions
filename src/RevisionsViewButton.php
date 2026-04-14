<?php

namespace Thomhines\KirbyRevisions;

use Kirby\Cms\ModelWithContent;
use Kirby\Panel\Ui\Buttons\ViewButton;
use Kirby\Toolkit\I18n;

class RevisionsViewButton extends ViewButton
{
	public function __construct(ModelWithContent $model)
	{
		parent::__construct(
			class: 'k-revisions-view-button',
			component: 'k-view-button',
			disabled: $model->permissions()->cannot('update'),
			drawer: $model->panel()->url(true) . '/revisions',
			icon: 'layers',
			size: 'sm',
			text: I18n::translate('thomhines.kirby-revisions.button', 'Revisions'),
			title: I18n::translate('thomhines.kirby-revisions.button.title', 'Content revisions'),
			variant: 'filled',
		);
	}
}
