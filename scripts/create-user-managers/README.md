# create-user-managers
Script creates users with the `user_manager` role.

To run the tool:

```sh
$ npx ts-node scripts/create-user-managers/index.ts --names "Stan Lee" "Beatrice Bass" --passwords "S3cret_abc" "S3cret_123" --county "Vihiga" --hostname localhost:5988 --adminUsername medic --adminPassword password
...
===================================================
username: stan_lee95      password: S3cret_abc
username: beatrice_bass   password: S3cret_123
===================================================
```