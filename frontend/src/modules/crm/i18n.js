// CRM interface strings. Russian only for now; adding Uzbek means adding an
// `uz` dictionary with the same keys and a way to pick the language.

const ru = {
    'nav.leads': 'Заявки',
    'nav.clients': 'Клиенты',
    'nav.access': 'Доступ',
    'home.comingSoon': 'Разделы для вашей роли (финансы, зарплаты) появятся на следующих этапах.',

    'common.loading': 'Загрузка...',
    'common.save': 'Сохранить',
    'common.saving': 'Сохранение...',
    'common.cancel': 'Отмена',
    'common.back': '← Назад',
    'common.edit': 'Изменить',
    'common.more': 'Показать ещё',
    'common.search': 'Поиск по имени, телефону, Instagram',
    'common.notSet': 'Не указан',
    'common.none': '—',

    'leadStatus.new': 'Новый',
    'leadStatus.in_progress': 'В обработке',
    'leadStatus.waiting_reply': 'Ожидает ответа',
    'leadStatus.booked': 'Записан',
    'leadStatus.arrived': 'Приехал',
    'leadStatus.order_created': 'Заказ оформлен',
    'leadStatus.completed': 'Завершён',
    'leadStatus.lost': 'Отказался',

    'channel.instagram': 'Instagram',
    'channel.telegram': 'Telegram',
    'channel.phone': 'Звонок',
    'channel.walk_in': 'Пришёл сам',
    'channel.website': 'Сайт',
    'channel.other': 'Другое',

    'leads.title': 'Заявки',
    'leads.new': '+ Заявка',
    'leads.filter.open': 'Активные',
    'leads.filter.all': 'Все',
    'leads.empty': 'Заявок пока нет.',
    'leads.emptyFiltered': 'Ничего не найдено.',
    'lead.title': 'Заявка №{number}',
    'lead.status': 'Статус',
    'lead.statusAuto': 'Статус меняется автоматически при оформлении и выдаче заказа.',
    'lead.lostReason': 'Причина отказа',
    'lead.lostReasonPlaceholder': 'Например, дорого',
    'lead.markLost': 'Отметить отказ',
    'lead.channel': 'Канал обращения',
    'lead.source': 'Источник',
    'lead.manager': 'Ответственный',
    'lead.bookedFor': 'Записан на',
    'lead.notes': 'Заметки',
    'lead.history': 'История',
    'lead.created': 'Создана',
    'lead.client': 'Клиент',

    'newLead.title': 'Новая заявка',
    'newLead.clientSection': 'Клиент',
    'newLead.leadSection': 'Обращение',
    'newLead.found': 'Этот клиент уже есть в базе',
    'newLead.useFound': 'Создать заявку для него',
    'newLead.otherClient': 'Выбрать другого клиента',
    'newLead.submit': 'Создать заявку',
    'newLead.bookedHint': 'Если указать дату, заявка сразу получит статус «Записан».',

    'clients.title': 'Клиенты',
    'clients.new': '+ Клиент',
    'clients.empty': 'Клиентов пока нет.',
    'client.firstName': 'Имя',
    'client.lastName': 'Фамилия',
    'client.phone': 'Телефон',
    'client.phonePlaceholder': '+998 90 123 45 67',
    'client.instagram': 'Instagram',
    'client.telegram': 'Telegram',
    'client.source': 'Источник',
    'client.manager': 'Менеджер',
    'client.notes': 'Заметки',
    'client.firstContact': 'Первое обращение',
    'client.newTitle': 'Новый клиент',
    'client.editTitle': 'Редактирование клиента',
    'client.duplicate': 'Такой клиент уже есть:',
    'client.openExisting': 'Открыть карточку',
    'client.leads': 'Заявки',
    'client.noLeads': 'Заявок нет.',
    'client.newLead': '+ Новая заявка',
    'client.vehicles': 'Автомобили',
    'client.orders': 'Заказы',
    'client.comments': 'Комментарии',
    'client.noComments': 'Комментариев пока нет.',
    'client.commentPlaceholder': 'Комментарий менеджера',
    'client.addComment': 'Добавить',

    'access.title': 'Доступ к CRM',
    'access.hint': 'Сотрудники без роли не видят CRM. Мастерам доступ не нужен — их карточки ведутся в разделе «Сотрудники».',
    'access.noAccess': 'Нет доступа',
    'access.owner': 'Владелец — полный доступ',
    'access.you': 'Это вы',
    'access.inactive': 'деактивирован',
    'access.rolesTitle': 'Что может каждая роль',

    'permission.dashboard.view': 'Dashboard',
    'permission.leads.manage': 'Заявки',
    'permission.clients.manage': 'Клиенты',
    'permission.vehicles.manage': 'Автомобили',
    'permission.orders.manage': 'Заказы',
    'permission.orders.issue': 'Выдача заказов',
    'permission.payments.record': 'Приём оплат',
    'permission.finance.view': 'Просмотр финансов',
    'permission.finance.manage': 'Расходы и кассы',
    'permission.staff.manage': 'Сотрудники',
    'permission.payroll.view': 'Просмотр зарплат',
    'permission.payroll.manage': 'Выплаты зарплат',
    'permission.marketing.view': 'Маркетинг',
    'permission.messages.send': 'Ответы клиентам',
    'permission.settings.manage': 'Настройки и доступ',
};

const dictionaries = { ru };
const language = 'ru';

export function t(key, vars) {
    const template = dictionaries[language][key] ?? dictionaries.ru[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? '').toString());
}

export const LEAD_STATUSES = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived', 'order_created', 'completed', 'lost'];
// Statuses a manager sets by hand; the rest come from the order flow.
export const MANUAL_LEAD_STATUSES = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived'];
export const OPEN_LEAD_STATUSES = ['new', 'in_progress', 'waiting_reply', 'booked', 'arrived', 'order_created'];
export const CHANNELS = ['instagram', 'telegram', 'phone', 'walk_in', 'website', 'other'];
