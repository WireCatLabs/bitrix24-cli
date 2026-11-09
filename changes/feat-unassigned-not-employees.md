### Changed — may break callers

- For anyone but a manager, `crm.bitrix24:<portal>.unassigned` counts only users the portal shows as dismissed or as
  not employees (extranet, e-mail, bot), checked at every sync. A working employee in the list is left out with the
  reason in the sync's `issues` (`crm.unassigned-dropped`), and their deals and leads leave the local copy. A manager
  may still list anyone. Watch for: a webhook without the `user` scope counts no one as unassigned for an employee.
