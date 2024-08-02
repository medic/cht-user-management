# CHT Watchdog config files

These files will allow a [CHT Watchdog](https://github.com/medic/cht-watchdog/) instance to easily query CHT User **Management Tool** `/metrics`endpoint to enable monitoring

## Install

##### Prerequisites:

* Watchdog instance
* User Management Tool instance - reachable by Watchdog

##### Install:

1. On your Watchdog server, check out `cht-user-management` [repo](https://github.com/medic/cht-user-management/) one directory up from CHT Watchdog directory.
2. Symlink in `watchdog-config` from `cht-user-management`  to the base of `cht-watchdog` repo:
3. Go to the root of `cht-watchdog` directory in the terminal and then run below command `ln -s ./cht-user-management/scripts/deploy/watchdog-config/ user-management`
4. You might need to update thes variables in **.**`env` from  directory to avoid conflict with the port `3000` on which `grafana` is runing.

   ```
   PORT=3000 		# for development environment
   EXTERNAL_PORT=3000	# for docker
   ```
5. Start Watchdog with the additional compose file:

   ```
   docker-compose -f docker-compose.yml \-f user-management/user-management-compose.yml up -d --remove-orphans
   ```

## Visualizing metrics

#### Prometheus instance runing

1. Open this url [http://127.0.0.1:9090/](Prometheus) and it will take you to prometheus home page where you can check the metrics instances status(`Up, Down, Unknown`).
   1. Steps to check the status
      1. Go to `Status` in the menu bar
      2. Select Target  and check that the status of cht-user management is up
2. To check if data is populated in prometheus then go to graph and run a query on any of the metrics from user.

#### Add dashboard to Grafana

1. Open this url [http://localhost:3000]() and it will take you to grafana home page
2. Click on `hamburger menu` and then select dashboard
3. Click on add new dashboard and then add visualization, then select prometheus as data source
4. Look for metrics and select the metric you would like to visualize and run queries to see data representation.

#### Add dashboard from template

1. Go to [https://grafana.com/grafana/dashboards/]() and select the template you want
2. On right side of the template detail page and copy the template `ID`
3. Back to grafana home [http://localhost:3000]()
4. Click on `hamburger menu` and then select dashboard
5. Click on add new dashboard and then import dashbord, then paste the copied ID and click on load.
