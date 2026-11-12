### Fixed

- `crm sync` with activities on also keeps an e-mail, call or meeting whose own owner is a contact or company and
  that is only bound to your deal or lead. Before, such an activity never reached `deals show`.
