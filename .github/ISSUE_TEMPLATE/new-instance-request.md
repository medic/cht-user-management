---
name: New instance request
about: Details for new instance
title: New User Managament Tool instance for $PARTNERS_NAME


---

**Partner Name**: _$PARTNERS_NAME_
**Proposed URL**: users-chis-_$COUNTRY_-cht-user-management
**Config Name**: users-chis-$COUNTRY



**Action Items**
- [ ]  verify URL: https://users-chis-$COUNTRY.app.medicmobile.org
- [ ]  ensure repo has [config](https://github.com/medic/cht-user-management/tree/main/src/config) for $COUNTRY. Directory and config name needs to match URL
- [ ]  create DNS entry: `CNAME` of `users-chis-$COUNTRY.app.medicmobile.org` -> `k8s-prodchtalb-dcc00345ac-1792311525.eu-west-2.elb.amazonaws.com`
- [ ]  create helm values file in [correct location](https://github.com/medic/cht-user-management/tree/main/scripts/deploy/values)
- [ ]  `helm install` chart so the instance is live at above URL [per docs](https://github.com/medic/cht-user-management/blob/main/scripts/deploy/medic-deploy.md)
- [ ]  update docs to have new instance in the `Known cofigurations` section
