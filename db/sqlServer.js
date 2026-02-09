const useTrusted =
  String(process.env.DB_TRUSTED_CONNECTION || "true").toLowerCase() === "true";
const sql = useTrusted ? require("mssql/msnodesqlv8") : require("mssql");

let poolPromise;

function getPool() {
  if (!poolPromise) {
    const rawServer = process.env.DB_SERVER || ".";
    const [server, portFromEnv] = String(rawServer).split(",");
    const database = process.env.DB_NAME || "SanzoDB";

    const config = {
      server: server || ".",
      database,
      options: {
        trustServerCertificate: true,
      },
    };
    const parsedPort = Number(portFromEnv);
    if (Number.isInteger(parsedPort) && parsedPort > 0) {
      config.options.port = parsedPort;
    }

    if (useTrusted) {
      const odbcDriver =
        process.env.DB_ODBC_DRIVER || "ODBC Driver 17 for SQL Server";
      config.connectionString = `Driver={${odbcDriver}};Server=${server};Database=${database};Trusted_Connection=Yes;`;
    } else {
      config.user = process.env.DB_USER;
      config.password = process.env.DB_PASSWORD;
    }

    poolPromise = sql.connect(config);
  }

  return poolPromise;
}

module.exports = {
  sql,
  getPool,
};
